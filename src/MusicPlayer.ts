import DiscordJS from 'discord.js';
import {joinVoiceChannel, createAudioPlayer, createAudioResource, VoiceConnection, AudioPlayerStatus, AudioPlayerState, AudioPlayer, VoiceConnectionStatus} from '@discordjs/voice';
import { Readable } from 'stream';
import fs from 'fs';
import path from 'path';

import Logger from './Logger'
import {YoutubeToken, ResourcePath, SongRankPath, SongRankPrefix} from './Token.json';
import { VoiceConnectionDisconnectedOtherState } from '@discordjs/voice';

const DBEUGMODE = true;

const gYoutubeLink = "https://www.youtube.com/watch";
const gYoutubeLinkVideoIDKeyword = "v";

const gQueryPlayListMaxCount = 25;

const gSongRankSaveIntervalSecond = 3600;
const gDisconnectTimeoutSecond = 60;

class Queue<T>
{
    _array: Array<T>;

    constructor()
    {
        this._array = [];
    }

    enqueue(data: T)
    {
        this._array.push(data);
    }

    dequeue()
    {
        return this._array.shift();
    }

    indexOf(data: T)
    {
        return this._array.indexOf(data);
    }
}

class MaxQueue<T> extends Queue<T>
{
    _maxCount: number;

    constructor(maxCount: number)
    {
        super();
        this._maxCount = maxCount;
    }

    enqueue(data: T)
    {
        if(this._array.length == this._maxCount)
            super.dequeue();
        
        super.enqueue(data);
    }
}

class SongInformation
{
    _title: string;
    _id: string;
    _duration: string;
    constructor(id: string, title: string, duration: string)
    {
        this._title = title;
        this._id = id;
        this._duration = duration;
    }
}

class SearchInformation
{
    _songInformationArr: Array<SongInformation>
    _message: DiscordJS.Message;
    constructor(songInformation: Array<SongInformation>, message: DiscordJS.Message)
    {
        this._songInformationArr = songInformation;
        this._message = message;
    }
}

class SongPlayInformation
{
    _songInformation: SongInformation;
    _voiceChannelID: DiscordJS.Snowflake;
    _textChannel: DiscordJS.TextBasedChannel;
    _guildeID: DiscordJS.Snowflake;
    _adapterCreator: DiscordJS.InternalDiscordGatewayAdapterCreator;

    _errorCount: number;

    constructor(songInfo: SongInformation, voiceChannelID: DiscordJS.Snowflake, textChannel: DiscordJS.TextBasedChannel, guildID: DiscordJS.Snowflake, creator: DiscordJS.InternalDiscordGatewayAdapterCreator)
    {
        this._songInformation = songInfo;
        this._voiceChannelID = voiceChannelID;
        this._textChannel = textChannel;
        this._guildeID = guildID;
        this._adapterCreator = creator;

        this._errorCount = 0;
    }
}

enum VideoQueryType
{
    TITLE, 
    DURATION,    
}
class YoutubeHelper
{
    static kPrefixURL: string = 'https://www.googleapis.com/youtube/v3/';
    constructor()
    {}

    private static async queryVideo(queryType: VideoQueryType, videoIDArr: Array<string>)
    {
        let partName = queryType == VideoQueryType.TITLE ? "snippet" : "contentDetails";
        let url = `${this.kPrefixURL}videos?part=${partName}&key=${YoutubeToken}&id=`;
        let count = videoIDArr.length;
        for(var i = 0; i < count; ++i)
        {
            url += videoIDArr[i];
            if(i < count - 1)
                url += ",";
        }

        let res = await fetch(url);
        let body = await res.text();
        let obj = JSON.parse(body);

        let returnArr = Array<string>();
        let typeName = queryType == VideoQueryType.TITLE ? "title" : "duration";
        for(const item of obj['items'])
            returnArr.push(item[partName][typeName]);

        return returnArr;
    }

    static async queryVideoTitleArr(videoIDArr: Array<string>)
    {
        // https://developers.google.com/youtube/v3/docs/videos/list?hl=ko
        return await YoutubeHelper.queryVideo(VideoQueryType.TITLE, videoIDArr);
    }

    static async queryVideoDurationArr(videoIDArr: Array<string>)
    {
        // https://developers.google.com/youtube/v3/docs/videos/list?hl=ko
        let durationArr = await YoutubeHelper.queryVideo(VideoQueryType.DURATION, videoIDArr);
        
        function YTDurationToSeconds(duration: string)
        {
            let match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
            
            let match2 = match!.slice(1).map(function(x) {
                if (x != null)
                return x.replace(/\D/, '');
            });
            
            let hours = (parseInt(match2[0]!) || 0);
            let minutes = (parseInt(match2[1]!) || 0);
            let seconds = (parseInt(match2[2]!) || 0);
            
            let ret = "";
            if(hours > 0)
            ret += "" + hours + ":" + (minutes < 10 ? "0" : "");
            
            ret += "" + minutes + ":" + (seconds < 10 ? "0" : "");
            ret += "" + seconds;
            
            return ret;
        }
        
        // query에서 이미 durationArr의 index와 videoIDArr의 index가 서로 정렬되어 있습니다.
        // 만약 정렬되지 않는다면 여리서 정렬해야합니다.

        durationArr = durationArr.map((value: string) => {
            return YTDurationToSeconds(value);
        });

        return durationArr;
    }

    static createSongInformation(idArr: Array<string>, titleArr: Array<string>, durationArr: Array<string>)
    {
        let songInformationArr: Array<SongInformation> = [];
        if((idArr.length != durationArr.length) || (titleArr.length != durationArr.length))
        {
            Logger.error("ID와 Duration의 개수가 다릅니다. ", idArr.length, " / ", durationArr.length);
            return songInformationArr;
        }

        for(let i = 0; i < idArr.length; ++i)
            songInformationArr.push(new SongInformation(idArr[i], titleArr[i], durationArr[i]));

        return songInformationArr;
    }

    static async queryKeyword(keyword : string)
    {
        let idArr = [];
        let titleArr = [];
        {
            let attributeArr = [
                'part=snippet', // id, snippet
                'q=' + keyword, 
                //'order=relevance' // default=relevance, [date, rating, relevance, title, videoCount, viewCount]
                'regionCode=kr', 
                'maxResults=10', // default=5, 0~50
                'type=video', //channel, playlist, video
                //'videoDuration=any' + default: any, [any, long(20분), medium(4~20), short(4)]
            ];
            let url = this.kPrefixURL + 'search?' + 'key=' + YoutubeToken;
            for(const attr of attributeArr)
            {
                url += '&';
                url += attr
            }
    
            let res = await fetch(url);
            let body = await res.text();
            let obj = JSON.parse(body);
            for(const item of obj['items'])
            {
                idArr.push(item['id']['videoId']);
                titleArr.push(item['snippet']['title']);
            }
        }

        let durationArr = await YoutubeHelper.queryVideoDurationArr(idArr);

        return YoutubeHelper.createSongInformation(idArr, titleArr, durationArr);
    }

    static async queryPlayList(listID: string)
    {
        // https://developers.google.com/youtube/v3/docs/playlistItems/list?hl=ko
        let url = `${YoutubeHelper.kPrefixURL}playlistItems?part=snippet&key=${YoutubeToken}&playlistId=${listID}&maxResults=${gQueryPlayListMaxCount}`;
        let res = await fetch(url);
        let body = await res.text();
        let obj = JSON.parse(body);
        if("error" in obj)
            return [];

        let idArr: Array<string> = [];
        let titleArr: Array<string> = [];
        let itemArr = obj['items'];
        let itemCount = itemArr.length;
        for(let i = 0; i < itemCount; ++i)
        {
            idArr.push(itemArr[i]["snippet"]["resourceId"]["videoId"]);
            titleArr.push(itemArr[i]["snippet"]["title"]);
        }

        let durationArr = await YoutubeHelper.queryVideoDurationArr(idArr);

        return YoutubeHelper.createSongInformation(idArr, titleArr, durationArr);
    }
}

enum PlayCommandType
{
    SEARCH, 
    PLAYSEARCH,
    PLAYLINKLIST, 
    PLAYLINKVEDIO, 
}
export class Message
{
    _target: DiscordJS.CommandInteraction | DiscordJS.Message;

    constructor(target: DiscordJS.CommandInteraction | DiscordJS.Message)
    {
        this._target = target;
    }

    getPlayCommandType()
    {
        let content = this.getContent();

        if(isNaN(Number(content)) == false && typeof(Number(content)) == "number")
            return PlayCommandType.PLAYSEARCH;
        else if(content.includes(`${gYoutubeLink}`) == true)
        {
            if(content.includes('list='))
                return PlayCommandType.PLAYLINKLIST;
            else
                return PlayCommandType.PLAYLINKVEDIO;
        }
        else
            return PlayCommandType.SEARCH;
    }

    getVoiceChannel()
    {
        if(this._target instanceof DiscordJS.CommandInteraction)
            return (this._target.member as DiscordJS.GuildMember).voice.channel;
        else
            return this._target.member!.voice.channel;
    }

    async reply(sentence: string, deleteMessage: boolean)
    {
        if(this._target instanceof DiscordJS.CommandInteraction)
            return await this._target.followUp({ephemeral: true, content: sentence});
        else
        {
            if(deleteMessage)
            {
                await this._target.delete();
                return await this._target.channel.send(sentence);
            }
            else
                return await this._target.reply(sentence);
        }
    }

    getContent()
    {
        if(this._target instanceof DiscordJS.CommandInteraction)
            return this._target.options.get('content')?.value as string;
        else
        {
            if(isNaN(Number(this._target.content.slice(1))) == false)
                return this._target.content.slice(1);
            else
                return this._target.content.slice(3);
        }
    }

    getUserID()
    {
        if(this._target instanceof DiscordJS.CommandInteraction)
            return this._target.user.id;
        else
            return this._target.author.id;
    }

    getTextChannel()
    {
        return this._target.channel!;
    }

    getGuildID()
    {
        return this._target.guildId!;
    }

    getVoiceAdapterCreator()
    {
        return this._target.guild!.voiceAdapterCreator;
    }
}

export class MusicPlayer
{
    _client: DiscordJS.Client;
    _guildID: string;
    
    _autoRandomPlay: boolean;
    _songHistory: MaxQueue<string>;
    _searchMap: Map<string, SearchInformation>;
    _songList: Array<SongPlayInformation>;
    _connection: VoiceConnection | undefined;
    _player: AudioPlayer | undefined;
    _disconnectionTimer: NodeJS.Timeout | undefined;
    _currentPlayingSongInformation: SongPlayInformation | undefined;
    _songRankInformationMap: Map<string, number>;
    _songRankSaveInterval: NodeJS.Timer;

    constructor(client: DiscordJS.Client, guildID: string)
    {
        this._client = client;
        this._guildID = guildID;

        this._autoRandomPlay = false;
        this._songHistory = new MaxQueue(50);
        this._searchMap = new Map<string, SearchInformation>();
        this._songList = new Array<SongPlayInformation>;
        this._connection = undefined;
        this._player = undefined;
        this._disconnectionTimer = undefined;
        this._currentPlayingSongInformation = undefined;

        let rankFilePath = `${ResourcePath}/${SongRankPath}/${SongRankPrefix}_${this._guildID}.json`;
        if(fs.existsSync(rankFilePath) == false)
        {
            fs.mkdirSync(path.dirname(rankFilePath), {recursive: true});
            fs.writeFileSync(rankFilePath, '{}');
        }

        const data = fs.readFileSync(rankFilePath, {encoding: 'utf-8'});
        const loadObj = JSON.parse(data);
        this._songRankInformationMap = new Map(Object.entries(loadObj));

        this._songRankSaveInterval = setInterval(() => {
            Logger.logDev("--- Save Song Rank Information ---");
            let sentence = Object.fromEntries(this._songRankInformationMap);
            fs.writeFileSync(rankFilePath, JSON.stringify(sentence));
        }, 1000 * gSongRankSaveIntervalSecond);
    }

    update(deltaTime: number) : void
    {
        if(this._currentPlayingSongInformation?._voiceChannelID == undefined)
            return;

        const voiceChannel = this._client.guilds.cache.get(this._guildID)?.channels.cache.get(this._currentPlayingSongInformation._voiceChannelID) as DiscordJS.VoiceBasedChannel;
        if(voiceChannel.members.size == 1)  // 1명 >> Sona 자기자신만 있는 경우
            this.disconnect();
    }

    private checkVoiceChannel(voiceChannel: DiscordJS.VoiceBasedChannel | null)
    {
        return !(voiceChannel == undefined || voiceChannel.type != DiscordJS.ChannelType.GuildVoice);
    }

    async playCommand(message: Message)
    {
        const voiceChannel = message.getVoiceChannel();
        if(this.checkVoiceChannel(voiceChannel) == false)
        {
            await message.reply("먼저 VoiceChannel에 입장해주세요.", true);
            return;
        }

        const content = message.getContent();
        const playCommandType = message.getPlayCommandType();
        switch (playCommandType) {
            case PlayCommandType.SEARCH:
            {
                let searchInfo = this._searchMap.get(message.getUserID());
                if(searchInfo != undefined)
                    searchInfo!._message.delete();

                let songInfoArr: Array<SongInformation> = await YoutubeHelper.queryKeyword(content);

                let sentence = `${content} 검색결과\n`;
                for(let i = 0; i < songInfoArr.length; ++i)
                    sentence += `${i + 1}. ${songInfoArr[i]._title}(${songInfoArr[i]._duration})\n`;

                let reply = await message.reply(sentence, false);
                this._searchMap.set(message.getUserID(), new SearchInformation(songInfoArr, reply));
            }
            return;
            case PlayCommandType.PLAYSEARCH:
            {
                const userID = message.getUserID();
                const searchInfo = this._searchMap.get(userID);
                if(!searchInfo)
                {
                    await message.reply("노래찾기를 먼저 해주세요.", true);
                    return;
                }
                this._searchMap.delete(userID);

                const songIndex = Number(content) - 1;
                if(songIndex < 0 || songIndex >= searchInfo._songInformationArr.length)
                {
                    await message.reply("올바른 Index를 입력해주세요. 0보다 작거나 검색범위 밖입니다.", false);
                    return;
                }

                this._songList.push(new SongPlayInformation(searchInfo._songInformationArr[songIndex], voiceChannel!.id, message.getTextChannel(), message.getGuildID(), message.getVoiceAdapterCreator()));
                await message.reply(`${searchInfo._songInformationArr[songIndex]._title}(${searchInfo._songInformationArr[songIndex]._duration}) 노래가 추가되었습니다.`, true);
                await searchInfo._message.delete();
            }
            break;
            case PlayCommandType.PLAYLINKLIST:
            {
                let temp = content.split('list=')[1];
                let listID = temp.split('&')[0];
                let songInfoArr = await YoutubeHelper.queryPlayList(listID);
                let songInfoCount = songInfoArr.length;
                if(songInfoCount == 0)
                {
                    await message.reply("PlayList가 올바르지 않습니다.", true);
                    return;
                }

                for(let i = 0; i < songInfoCount; ++i)
                    this._songList.push(new SongPlayInformation(songInfoArr[i], voiceChannel!.id, message.getTextChannel(), message.getGuildID(), message.getVoiceAdapterCreator()));

                await message.reply(`총 ${songInfoCount}개의 노래가 추가되었습니다.`, true);
            }
            break;
            case PlayCommandType.PLAYLINKVEDIO:
            {
                const temp = content.split(`${gYoutubeLinkVideoIDKeyword}=`);
                const videoID = temp[1].split(`&`)[0];
                const durationArr = await YoutubeHelper.queryVideoDurationArr([videoID]);
                const title = (await YoutubeHelper.queryVideoTitleArr([videoID]))[0];
                const songInfo = new SongInformation(videoID, title, durationArr[0]);
                this._songList.push(new SongPlayInformation(songInfo, voiceChannel!.id, message.getTextChannel(), message.getGuildID(), message.getVoiceAdapterCreator()));
                await message.reply(`${title}(${durationArr[0]}) 노래가 추가되었습니다.`, true);
            }
            break;
            default:
                Logger.error(`비정상적 PlayCommandType${PlayCommandType}입니다. 개발자에게 알려주세요.`);
            return;
        }
        
        // 현재 노래 재생중이 아니라면 자동으로 노래 하나를 재생합니다.
        if(this._currentPlayingSongInformation == undefined)
            this.nextSong();
    }

    async skipSongCommand()
    {
        this.nextSong();    // 내부에서 자동으로 재생중인 곡은 넘어감
    }

    async listSongCommand(message: Message)
    {
        if(this._songList.length == 0)
            message.reply("재생목록이 비었습니다.", true);
        else
        {
            let sentence = `Count: ${this._songList.length}` + "```";
            for(let i = 0; i < this._songList.length; ++i){
                let tempString = 
                `${i}. ${this._songList[i]._songInformation._title}(${this._songList[i]._songInformation._duration})\n`;

                // discord 정책상 2000글자가 제한임
                // 외 남은 곡수를 붙이기 위해 50자를 더 여유롭게 책정함
                if(sentence.length + tempString.length > 1950)
                {
                    sentence += `외 남은 곡수: ${this._songList.length - i + 1}\n`;
                    break;
                }

                sentence += tempString;
            }
            sentence += "```";

            message.reply(sentence, true);
        }
    }

    private async randomSongInternal(count: number, output: {outVideoIDArr: Array<string>, outTitleArr: Array<string>, outDurationArr: Array<string>})
    {
        let videoIDArr = Array.from(this._songRankInformationMap.keys());
        let videoIDCount = videoIDArr.length;
        let percentageArr = Array<number>();
        for(let i = 0; i < videoIDCount; ++i)
        {
            let percent = -i + videoIDCount;
            for(let j = 0; j < percent; ++j)
                percentageArr.push(i);
        }

        function shuffle<T>(array: Array<T>)
        {
            for (let index = array.length - 1; index > 0; index--) {
                // 무작위 index 값을 만든다. (0 이상의 배열 길이 값)
                const randomPosition = Math.floor(Math.random() * (index + 1));
            
                // 임시로 원본 값을 저장하고, randomPosition을 사용해 배열 요소를 섞는다.
                const temporary = array[index];
                array[index] = array[randomPosition];
                array[randomPosition] = temporary;
            }
        }
        shuffle(percentageArr);

        let maxCount = Math.min(videoIDArr.length, count);
        let limitLoopCount = 1000;
        for(let i = 0; i < maxCount && i < limitLoopCount; ++i, ++limitLoopCount)
        {
            let randomIndex = Math.floor(Math.random() * percentageArr.length);
            let percentIndex = percentageArr[randomIndex];
            let videoID = videoIDArr[percentIndex];

            // 이미 재생목록에 있는 건 추가하지 않는다.
            if(this._songList.find(element => element._songInformation._id == videoID) != undefined)
            {
                --i;
                continue;
            }

            // 히스토리 목록에 있던 건 추가하지 않는다.
            if(this._songHistory.indexOf(videoID) != -1)
            {
                --i;
                continue;
            }

            // 이미 추가된 건 추가하지 않는다.
            if(output.outVideoIDArr.indexOf(videoID) != -1)
            {
                --i;
                continue;
            }

            output.outVideoIDArr.push(videoID);
        }

        output.outTitleArr = output.outTitleArr.concat(await YoutubeHelper.queryVideoTitleArr(output.outVideoIDArr));
        output.outDurationArr = output.outDurationArr.concat(await YoutubeHelper.queryVideoDurationArr(output.outVideoIDArr));

        let errorCount = 0;
        for(let i = 0; i < output.outVideoIDArr.length; ++i)
        {
            if(output.outVideoIDArr[i] == undefined || output.outTitleArr[i] == undefined || output.outDurationArr[i] == undefined )
            {
                ++errorCount;

                //this._songRankInformationMap.delete(output.outVideoIDArr[i]);
                output.outVideoIDArr.splice(i, 1);
                output.outTitleArr.splice(i, 1);
                output.outDurationArr.splice(i, 1);
            }
        }

        if(errorCount > 0)
            output = await this.randomSongInternal(errorCount, output);

        return output;
    }

    async randomSongCommand(message: Message, count: number)
    {
        Logger.logDev("--- Random Song ---");

        const voiceChannel = message.getVoiceChannel();
        if(this.checkVoiceChannel(voiceChannel!) == false)
        {
            await message.reply("먼저 VoiceChannel에 입장해주세요.", true);
            return;
        }

        if(this._songRankInformationMap.size == 0)
        {
            await message.reply("노래 랭킹이 없습니다. 음악을 들어주세요.", true);
            return;
        }

        let videoIDArr = Array<string>();
        let titleArr = Array<string>();
        let durationArr = Array<string>();
        let output = await this.randomSongInternal(count, {outVideoIDArr: videoIDArr, outTitleArr: titleArr, outDurationArr: durationArr});

        for(let i = 0; i < videoIDArr.length; ++i)
        {
            const songInfo = new SongInformation(output.outVideoIDArr[i], output.outTitleArr[i], output.outDurationArr[i]);
            this._songList.push(new SongPlayInformation(songInfo, voiceChannel!.id, message.getTextChannel(), message.getGuildID(), message.getVoiceAdapterCreator()));
        }

        await message.reply(`${videoIDArr.length}개의 랜덤 노래가 추가되었습니다.`, true);

        if(this._currentPlayingSongInformation == undefined)
            this.nextSong();
    }

    async rankSongCommand(message: Message)
    {
        if(this._songRankInformationMap.size == 0)
        {
            await message.reply("노래 랭킹이 없습니다. 음악을 들어주세요.", true);
            return;
        }

        // ID Array 구성
        let sortedMap = new Map([...this._songRankInformationMap].sort((a, b) => {
            return b[1] - a[1];
        }));

        let videoIDArr = Array<string>();
        let countArr = Array<number>();
        sortedMap.forEach((value, key) => {
            if(videoIDArr.length > 49)
                return;

            videoIDArr.push(key);
            countArr.push(value);
        });

        let titleArr = await YoutubeHelper.queryVideoTitleArr(videoIDArr);

        let sentence = "★SongRanking★```";
        for(let i = 0; i < titleArr.length; ++i)
        {
            let temp = `${i + 1}. ${titleArr[i]} (${countArr[i]})\n`;
            if(sentence.length + temp.length > 2000)
                break;

            sentence += temp;
        }
        sentence += "```";

        message.reply(sentence, true);
    }

    async autoRandomPlayCommand(message: Message)
    {
        this._autoRandomPlay = !this._autoRandomPlay;
        if(this._autoRandomPlay == false)
        {
            await message.reply("일반재생 모드로 변경되었습니다.", true);
            return;
        }

        await message.reply("자동재생 모드로 변경되었습니다.", true);
        if(this._currentPlayingSongInformation == undefined)
        {
            let videoIDArr = Array<string>();
            let titleArr = Array<string>();
            let durationArr = Array<string>();
            let output = await this.randomSongInternal(1, {outVideoIDArr: videoIDArr, outTitleArr: titleArr, outDurationArr: durationArr});
            for(let i = 0; i < videoIDArr.length; ++i)
            {
                const songInfo = new SongInformation(output.outVideoIDArr[i], output.outTitleArr[i], output.outDurationArr[i]);
                this._songList.push(new SongPlayInformation(songInfo, message.getVoiceChannel()!.id, message.getTextChannel(), message.getGuildID(), message.getVoiceAdapterCreator()));
            }

            this._currentPlayingSongInformation = this._songList.shift();
            this.playSong();
        }
    }

    async testCommand(message: Message)
    {
        Logger.logDev(this._songHistory);
        Logger.logDev(JSON.stringify(this._songList, null, '  '));
        Logger.logDev(JSON.stringify(this._currentPlayingSongInformation, null, '  '));
    }

    private async playSong()
    {
        Logger.logDev("--- Play Song ---");

        if(this._currentPlayingSongInformation == undefined)
        {
            this._player?.stop();
            this._disconnectionTimer = setTimeout(() => {this.disconnect()}, 1000 * gDisconnectTimeoutSecond);
            return;
        }

        this.clearDisconnectTimeout();

        if(this._connection == undefined)
        {
            Logger.logDev("--- Create Connection ---");
            this._connection = joinVoiceChannel({
                channelId: this._currentPlayingSongInformation!._voiceChannelID, 
                guildId: this._currentPlayingSongInformation!._guildeID, 
                adapterCreator: this._currentPlayingSongInformation!._adapterCreator
            });

            this._connection.on("error", error => {
                Logger.logDev("--- CN Error ---\n", error);
            })
            .on(VoiceConnectionStatus.Ready, () => {
                Logger.logDev("--- CN Ready ---");
            })
            .on(VoiceConnectionStatus.Connecting, () => {
                Logger.logDev("--- CN Connecting ---");
            })
            .on(VoiceConnectionStatus.Signalling, () => {
                Logger.logDev("--- CN Signaling ---");
            })
            .on(VoiceConnectionStatus.Disconnected, () => {
                Logger.logDev("--- CN Disconnected ---");
                this.disconnect();
            })
            .on(VoiceConnectionStatus.Destroyed, () => {
                Logger.logDev("--- CN Destroyed ---");
            });

            if(process.env.NODE_ENV !== 'production')
            {
                this._connection.on("debug", message =>{
                    Logger.logDev("--- CN Debug ---\n", message);
                });
            }
        }

        if(this._player == undefined)
        {
            Logger.logDev("--- Create AudioPlayer ---");

            this._player = createAudioPlayer();
            this._player.on('error', error => {
                Logger.logDev('--- MP Error ---\n', error);

                if(this._currentPlayingSongInformation!._errorCount >= 5)
                {
                    this.nextSong();
                    return;
                }

                // 오류가 났다면 현재 재생중인 곡을 다시 재생합니다.
                ++this._currentPlayingSongInformation!._errorCount;
                this._currentPlayingSongInformation!._textChannel.send(`${this._currentPlayingSongInformation!._songInformation._title}(${this._currentPlayingSongInformation!._songInformation._duration}) 재생 오류로 다시 재생합니다.`);
                this.playSong();
            })
            .on(AudioPlayerStatus.Idle, (oldState: AudioPlayerState, newState: AudioPlayerState) => {
                Logger.logDev('--- MP State Change ---');

                if(oldState.status == AudioPlayerStatus.Playing && newState.status == AudioPlayerStatus.Idle)
                {
                    const id = this._currentPlayingSongInformation!._songInformation._id;
                    let playCount = this._songRankInformationMap.get(id);
                    if(playCount == undefined)
                        this._songRankInformationMap.set(id, 1);
                    else
                        this._songRankInformationMap.set(id, playCount + 1);

                    this._songHistory.enqueue(id);
                    
                    this.nextSong();
                }
            });

            if(process.env.NODE_ENV !== 'production')
            {
                this._player.on('debug', message => {
                    Logger.logDev("--- MP Debug ---\n", message);
                })
            }
        }

        async function createAudioStream(info: SongPlayInformation)
        {
            if(false)
            {
                //https://velog.io/@tan90/youtube-dl
                /**
                 * 1. Video가 있는 Youtube HTML 가져오기
                 * 2. HTML에서 ytInitialPlayerResponse를 JSON로 만들기
                 * 3. JSON에서 streamingData.formats로 접근
                 * 4. 다음 분기를 따른다.
                 *  4-1. url이 있다면 url을 그냥 GET하면 동영상이 넘어온다.
                 *  4-2. url이 없는 경우 signatureChiper가 대신 있을 것
                 *      4-2-1. HTML에 base.js를 보면 복호화 코드가 있다.
                 *      4-2-2. 이 곳에 signatureChiper을 넣으면 복호화된 URL이 새로나온다.
                 *      4-2-3. 
                 */
                const html = await (await fetch(`${gYoutubeLink}?${gYoutubeLinkVideoIDKeyword}=Za9pOxEGqWU`)).text();
                const matches = html.match(/ytInitialPlayerResponse\s*=\s*({.+?})\s*;\s*(?:var\s+meta|<\/script|\n)/);
                const json = JSON.parse(matches![1]);
                if('url' in json.streamingData.formats)
                    Logger.logDev('url: ', json.streamingData.formats.url);
                else if('signatureCipher' in json.streamingData.formats)
                    Logger.logDev('signatureCipher: ', json.streamingData.formats.signatureCipher);
                else
                    Logger.logDev('There is no sourceURL!');

                // function decipher(a: any) {
                //     var b = {
                //         credentials: "include",
                //         cache: "no-store"
                //     };
                //     Object.assign(b, this.Y);
                //     this.B && (b.signal = this.B.signal);
                //     a = new Request(a,b);
                //     fetch(a).then(this.oa, this.onError).then(void 0, gy)
                // }

                return new Readable();
            }
            else if(true)
            {
                const url = `${gYoutubeLink}?${gYoutubeLinkVideoIDKeyword}=${info._songInformation._id}`;
                const {default: YTDL} = await import(`ytdl-core`);
                const stream = await YTDL(url, {
                    filter: "audioonly", 
                    quality: "highestaudio", 
                    highWaterMark: 1 << 25, 
                });
                return stream;
            }
            else
            {
                let fs = await import('fs');
                const stream = fs.createReadStream('../Sona/resource/cupid.mp3');
                return stream;
            }
        }

        const readStream = await createAudioStream(this._currentPlayingSongInformation!);
        const resource = createAudioResource(readStream);
        this._connection.subscribe(this._player);
        this._player.play(resource);

        this._currentPlayingSongInformation._textChannel.send(`${this._currentPlayingSongInformation._songInformation._title}(${this._currentPlayingSongInformation._songInformation._duration}) 노래를 재생합니다.`);
        Logger.logDev(`--- Play: ${this._currentPlayingSongInformation._songInformation._title}`);
    }

    private async nextSong()
    {
        Logger.logDev("--- Next Song ---");

        // 재생할 다음 곡이 없으면 그대로 disconnection 예약
        if(this._songList.length == 0)
        {
            if(this._autoRandomPlay == true)
            {
                let videoIDArr = Array<string>();
                let titleArr = Array<string>();
                let durationArr = Array<string>();
                let output = await this.randomSongInternal(1, {outVideoIDArr: videoIDArr, outTitleArr: titleArr, outDurationArr: durationArr});
                for(let i = 0; i < videoIDArr.length; ++i)
                {
                    const songInfo = new SongInformation(output.outVideoIDArr[i], output.outTitleArr[i], output.outDurationArr[i]);
                    this._songList.push(new SongPlayInformation(songInfo, this._currentPlayingSongInformation!._voiceChannelID, this._currentPlayingSongInformation!._textChannel, this._currentPlayingSongInformation!._guildeID, this._currentPlayingSongInformation!._adapterCreator));
                }
            }
        }

        this._currentPlayingSongInformation = this._songList.shift();
        this.playSong();
    }

    private disconnect()
    {
        this._autoRandomPlay = false;

        this._currentPlayingSongInformation = undefined;
        this._songList = new Array<SongPlayInformation>();
        
        this._player?.stop();
        this._player = undefined;
        this._connection?.disconnect();
        this._connection?.destroy();
        this._connection = undefined;
        this._disconnectionTimer = undefined;

        this.clearDisconnectTimeout();
    }

    private clearDisconnectTimeout()
    {
        clearTimeout(this._disconnectionTimer);
        this._disconnectionTimer = undefined;
    }
}