import DiscordJS, { DiscordjsError } from 'discord.js';
import {joinVoiceChannel, createAudioPlayer, createAudioResource, VoiceConnection, AudioPlayerStatus, AudioPlayerState, AudioPlayer, VoiceConnectionStatus, NoSubscriberBehavior} from '@discordjs/voice';
import { Readable } from 'stream';
import fs, { writeFile } from 'fs';
import path from 'path';

import Logger from './Logger'
import {YoutubeToken, ResourcePath, SongRankPath, SongRankPrefix} from './Token.json';
import { text } from 'stream/consumers';

const gPrefixGoogleAPI: string = 'https://www.googleapis.com/youtube/v3/';
const gYoutubeLink: string = "https://www.youtube.com/watch";
const gYoutubeLinkVideoIDKeyword: string = "v";

const gQueryPlayListMaxCount: number = 25;

const gSongRankSaveIntervalSecond: number = 3600;
const gSongHistoryMaxCount = 50;
const gDisconnectTimeoutSecond: number = 60;

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
    _duration: number;
    constructor(id: string, title: string, duration: number)
    {
        this._title = title;
        this._id = id;
        this._duration = duration;
    }

    getSongDurationString() : string
    {
        let hours = Math.floor(this._duration / 3600);
        let minutes = Math.floor((this._duration - hours * 3600) / 60);
        let seconds = this._duration % 60;

        let ret = "";
        if(hours > 0)
            ret += "" + hours + ":" + (minutes < 10 ? "0" : "");
        ret += "" + minutes + ":" + (seconds < 10 ? "0" : "");
        ret += "" + seconds;

        return ret;
    }
}

class SearchInformation
{
    _songInformationArr: Array<SongInformation>
    _textChannelID: DiscordJS.Snowflake;
    _messageID: DiscordJS.Snowflake | undefined;
    constructor(songInformation: Array<SongInformation>, textChannelID: DiscordJS.Snowflake, messageID: DiscordJS.Snowflake | undefined)
    {
        this._songInformationArr = songInformation;
        this._textChannelID = textChannelID;
        this._messageID = messageID;
    }
}

class SongPlayInformation
{
    _songInformation: SongInformation;
    _voiceChannelID: DiscordJS.Snowflake;
    _textChannelID: DiscordJS.Snowflake;

    constructor(songInfo: SongInformation, voiceChannelID: DiscordJS.Snowflake, textChannelID: DiscordJS.Snowflake)
    {
        this._songInformation = songInfo;
        this._voiceChannelID = voiceChannelID;
        this._textChannelID = textChannelID;
    }
}

enum VideoQueryType
{
    TITLE, 
    DURATION,    
}
class VideoTitleAndDurationQueryResult
{
    _title : string;
    _duration : number;

    constructor(title: string, duration: number)
    {
        this._title = title;
        this._duration = duration;
    }
}
class YoutubeHelper
{
    constructor()
    {}

    private static async queryVideo(queryType: VideoQueryType, videoIDArr: Array<string>) : Promise<Array<string | undefined>>
    {
        let returnArr = Array<string | undefined>();
        let count = videoIDArr.length;
        if(count == 0)
            return returnArr;

        let partName = queryType == VideoQueryType.TITLE ? "snippet" : "contentDetails";
        let url = `${gPrefixGoogleAPI}videos?part=${partName}&key=${YoutubeToken}&id=`;
        for(var i = 0; i < count; ++i)
        {
            url += videoIDArr[i];
            if(i < count - 1)
                url += ",";
        }

        let res = await fetch(url);
        let body = await res.text();
        let obj = JSON.parse(body);

        let resultVideoIDMap = new Map<string, any>();
        for(const item of obj['items'])
            resultVideoIDMap.set(item["id"], item[partName]);

        let typeName = queryType == VideoQueryType.TITLE ? "title" : "duration";
        for(const index in videoIDArr)
        {
            let value = resultVideoIDMap.get(videoIDArr[index]);
            if(value == undefined)
            {
                Logger.logDev(`Query(${typeName})실패. VideoID(${videoIDArr[index]})가 올바른지 확인이 필요합니다.`);
                returnArr.push(undefined);
            }
            else
                returnArr.push(value[typeName]);
        }

        return returnArr;
    }

    static async queryVideoTitleArr(videoIDArr: Array<string>) : Promise<Array<string | undefined>>
    {
        // https://developers.google.com/youtube/v3/docs/videos/list?hl=ko
        return await YoutubeHelper.queryVideo(VideoQueryType.TITLE, videoIDArr);
    }

    static async queryVideoDurationArr(videoIDArr: Array<string>) : Promise<Array<number | undefined>>
    {
        // https://developers.google.com/youtube/v3/docs/videos/list?hl=ko
        let durationArr: Array<string | undefined> = await YoutubeHelper.queryVideo(VideoQueryType.DURATION, videoIDArr);
        
        function YTDurationToSeconds(duration: string) : number
        {
            let match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
            
            let match2 = match!.slice(1).map(function(x) {
                if (x != null)
                return x.replace(/\D/, '');
            });
            
            let hours = (parseInt(match2[0]!) || 0);
            let minutes = (parseInt(match2[1]!) || 0);
            let seconds = (parseInt(match2[2]!) || 0);
            
            return hours * 3600 + minutes * 60 + seconds;
        }
        
        // query에서 이미 durationArr의 index와 videoIDArr의 index가 서로 정렬되어 있습니다.
        // 만약 정렬되지 않는다면 여리서 정렬해야합니다.

        let secondArr: Array<number | undefined> = durationArr.map((value: string | undefined) => {
            return value == undefined ? undefined : YTDurationToSeconds(value);
        });

        return secondArr;
    }

    static async queryVideoTitleAndDuration(videoIDArr: Array<string>) : Promise<Array<VideoTitleAndDurationQueryResult>>
    {
        let tempVideoIDArr = videoIDArr.slice();
        let titleArr = await this.queryVideoTitleArr(tempVideoIDArr);
        for(let i = 0; i < titleArr.length; ++i)
        {
            if(titleArr[i] == undefined)
            {
                titleArr.splice(i, 1);
                tempVideoIDArr.splice(i, 1);
                --i;
            }
        }

        let returnArr = Array<VideoTitleAndDurationQueryResult>();
        if(titleArr.length == 0)
            return returnArr;

        let durationArr = await this.queryVideoDurationArr(tempVideoIDArr);
        for(let i = 0; i < durationArr.length; ++i)
        {
            if(durationArr[i] == undefined)
            {
                durationArr.splice(i, 1);
                tempVideoIDArr.splice(i, 1);
                titleArr.splice(i, 1);
                --i;
            }

            returnArr.push(new VideoTitleAndDurationQueryResult(titleArr[i]!, durationArr[i]!));
        }

        return returnArr;
    }

    private static createSongInformation(idArr: Array<string>, titleArr: Array<string>, durationArr: Array<number>) : Array<SongInformation>
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

    static async queryKeyword(keyword : string) : Promise<Array<SongInformation>>
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
        let url = gPrefixGoogleAPI + 'search?' + 'key=' + YoutubeToken;
        for(const attr of attributeArr)
        {
            url += '&';
            url += attr
        }

        let res: Array<SongInformation> = await fetch(url)
        .then(async (response) => {
            let body = await response.text();
            let obj = JSON.parse(body);
    
            let idArr = [];
            let titleArr = [];
            for(const item of obj['items'])
            {
                idArr.push(item['id']['videoId']);
                titleArr.push(item['snippet']['title']);
            }
    
            // 방금 위에서 검색한 ID이므로 실패할 일이 없다고 가정합니다.
            let durationArr = await YoutubeHelper.queryVideoDurationArr(idArr) as Array<number>;
            return YoutubeHelper.createSongInformation(idArr, titleArr, durationArr);
        })
        .catch((error: string) => {
            Logger.error(error);
            let emptySongInformationArr: Array<SongInformation> = [];
            return emptySongInformationArr;
        });

        return res;
    }

    static async queryPlayList(listID: string) : Promise<Array<SongInformation>>
    {
        // https://developers.google.com/youtube/v3/docs/playlistItems/list?hl=ko
        let url = `${gPrefixGoogleAPI}playlistItems?part=snippet&key=${YoutubeToken}&playlistId=${listID}&maxResults=${gQueryPlayListMaxCount}`;
        let res = await fetch(url);
        let body = await res.text();
        let obj = JSON.parse(body);
        if("error" in obj)
        {
            Logger.error(obj["error"]);
            return [];
        }

        let idArr: Array<string> = [];
        let titleArr: Array<string> = [];
        let itemArr = obj['items'];
        let itemCount = itemArr.length;
        for(let i = 0; i < itemCount; ++i)
        {
            idArr.push(itemArr[i]["snippet"]["resourceId"]["videoId"]);
            titleArr.push(itemArr[i]["snippet"]["title"]);
        }

        // 방금 위에서 검색한 ID이므로 실패할 일이 없다고 가정합니다.
        let durationArr = await YoutubeHelper.queryVideoDurationArr(idArr) as Array<number>;

        return YoutubeHelper.createSongInformation(idArr, titleArr, durationArr);
    }
}

export class Message
{
    _target: DiscordJS.CommandInteraction | DiscordJS.Message;

    constructor(target: DiscordJS.CommandInteraction | DiscordJS.Message)
    {
        this._target = target;
    }

    getContent() : string
    {
        if(this._target instanceof DiscordJS.CommandInteraction)
        {
            return this._target.options.get('content')?.value as string;
        }
        else if(this._target instanceof DiscordJS.Message)
        {
            if(isNaN(Number(this._target.content.slice(1))) == false)
                return this._target.content.slice(1);
            else
                return this._target.content.slice(3);
        }

        Logger.error(`getContent: 올바르지 않은 MessageType(${typeof(this._target)}))입니다.`);
        return "";
    }

    getVoiceChannel() : DiscordJS.VoiceBasedChannel | null
    {
        if(this._target instanceof DiscordJS.CommandInteraction)
            return (this._target.member as DiscordJS.GuildMember).voice.channel;
        else if(this._target instanceof DiscordJS.Message)
            return this._target.member!.voice.channel;

        Logger.error(`getVoiceChannel: 올바르지 않은 MessageType(${typeof(this._target)}))입니다.`);
        return null;
    }

    getUserID() : string | undefined
    {
        if(this._target instanceof DiscordJS.CommandInteraction)
            return this._target.user.id;
        else if(this._target instanceof DiscordJS.Message)
            return this._target.author.id;

        Logger.error(`getUserID: 올바르지 않은 MessageType(${typeof(this._target)}))입니다.`);
        return undefined;
    }

    getTextChannelID() : string | undefined
    {
        if(this._target.channel == null)
            return undefined
        return this._target.channel.id;
    }

    getGuildID() : string | undefined
    {
        if(this._target.guildId == null)
            return undefined;
        return this._target.guildId;
    }

    async reply(sentence: string, deleteMessage: boolean) : Promise<DiscordJS.Snowflake | undefined>
    {
        if(this._target instanceof DiscordJS.CommandInteraction)
        {
            return (await this._target.followUp({ephemeral: true, content: sentence})).id;
        }
        else if(this._target instanceof DiscordJS.Message)
        {
            if(deleteMessage)
            {
                await this._target.delete();
                await this._target.channel.send(sentence);
                return undefined;
            }
            else
            {
                let replyMessage = await this._target.reply(sentence);
                return replyMessage.id;
            }
        }

        Logger.error(`reply: 올바르지 않은 MessageType(${typeof(this._target)}))입니다.`);
        return undefined;
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
        this._songHistory = new MaxQueue(gSongHistoryMaxCount);
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
            let sentence = Object.fromEntries(this._songRankInformationMap);
            fs.writeFile(rankFilePath, JSON.stringify(sentence), "utf8", (err) => {
                if(err)
                    Logger.error(err);
                else
                    Logger.logDev("Success FileWrite SongRank");
            });
        }, 1000 * gSongRankSaveIntervalSecond);
    }

    private getGuild() : DiscordJS.Guild
    {
        const guild = this._client.guilds.cache.get(this._guildID);
        if(guild == undefined)
            Logger.error(`사라진 Guild의 Session은 존재하면 안됩니다!! 반드시 수정해야함!`);

        return guild!;
    }
    private getChannelByID(channelID : DiscordJS.Snowflake) : DiscordJS.BaseChannel | undefined
    {
        const guild = this.getGuild();
        return guild.channels.cache.get(channelID);
    }
    private getVoiceChannelByID(channelID : DiscordJS.Snowflake) : DiscordJS.VoiceBasedChannel | undefined
    {
        const channel = this.getChannelByID(channelID);
        if(channel == undefined)
            return undefined;
        if(channel.isVoiceBased() == false)
            return undefined;

        return channel as DiscordJS.VoiceBasedChannel;
    }
    private getTextChannelByID(channelID : DiscordJS.Snowflake) : DiscordJS.TextBasedChannel | undefined
    {
        const channel = this.getChannelByID(channelID);
        if(channel == undefined)
            return undefined;
        if(channel.isTextBased() == false)
            return undefined;

        return channel as DiscordJS.TextBasedChannel;
    }
    private getMessageByID(channelID : DiscordJS.Snowflake, messageID : DiscordJS.Snowflake | undefined) : DiscordJS.Message | undefined
    {
        if(messageID == undefined)
            return undefined;

        const textChannel = this.getTextChannelByID(channelID);
        if(textChannel == undefined)
            return undefined;

        return textChannel.messages.cache.get(messageID);
    }

    update(deltaTime: number) : void
    {
        if(this._currentPlayingSongInformation == undefined || this._currentPlayingSongInformation._voiceChannelID == undefined)
            return;

        const voiceChannel = this.getVoiceChannelByID(this._currentPlayingSongInformation._voiceChannelID);
        if(voiceChannel == undefined)
            return;

        if(voiceChannel.members.size == 1)  // 1명 >> Sona 자기자신만 있는 경우
            this.disconnect();
    }

    private isValidVoiceChannel(voiceChannel: DiscordJS.VoiceBasedChannel | null) : boolean
    {
        return voiceChannel != null && voiceChannel != undefined && voiceChannel.type == DiscordJS.ChannelType.GuildVoice;
    }

    async playCommand(message: Message) : Promise<void>
    {
        Logger.logDev("MusicPlayer PlayCommand");

        const voiceChannel = message.getVoiceChannel();
        if(this.isValidVoiceChannel(voiceChannel) == false)
        {
            await message.reply("먼저 VoiceChannel에 입장해주세요.", true);
            return;
        }

        const userID = message.getUserID();
        if(userID == undefined)
            return;

        const textChannelID = message.getTextChannelID();
        if(textChannelID == undefined)
            return;

        enum PlayCommandType
        {
            SEARCH, 
            SEARCHPLAY,
            PLAYLINKLIST, 
            PLAYLINKVEDIO, 
        }
        function getPlayCommandType(content : string) : PlayCommandType
        {
            if(typeof(Number(content)) == "number" && isNaN(Number(content)) == false)
                return PlayCommandType.SEARCHPLAY;
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

        const content = message.getContent();
        const playCommandType = getPlayCommandType(content);
        switch (playCommandType) {
            case PlayCommandType.SEARCH:
            {
                const searchInfo = this._searchMap.get(userID);
                if(searchInfo != undefined)
                {
                    const msg = this.getMessageByID(searchInfo._textChannelID, searchInfo._messageID);
                    msg?.delete();
                }

                let songInfoArrData = await YoutubeHelper.queryKeyword(content);
                if(songInfoArrData.length == 0)
                {
                    let sentence = `검색도중 에러가 발생했습니다. 로그를 확인해야합니다.`;
                    await message.reply(sentence, false);
                }
                else
                {
                    let sentence = `${content} 검색결과\n`;
                    for(let i = 0; i < songInfoArrData.length; ++i)
                        sentence += `${i + 1}. ${songInfoArrData[i]._title}(${songInfoArrData[i].getSongDurationString()})\n`;
    
                    const replyMessageID = await message.reply(sentence, false);
                    this._searchMap.set(userID, new SearchInformation(songInfoArrData, textChannelID, replyMessageID));
                }
            }
            return;
            case PlayCommandType.SEARCHPLAY:
            {
                const searchInfo = this._searchMap.get(userID);
                if(searchInfo == undefined)
                {
                    await message.reply("노래찾기를 먼저 해주세요.", true);
                    return;
                }

                const songIndex = Number(content) - 1;
                if(songIndex < 0 || songIndex >= searchInfo._songInformationArr.length)
                {
                    await message.reply(`검색범위(${0}~${searchInfo._songInformationArr.length}) 밖입니다.`, false);
                    return;
                }

                this._searchMap.delete(userID);

                this._songList.push(new SongPlayInformation(searchInfo._songInformationArr[songIndex], voiceChannel!.id, textChannelID));

                const msg = this.getMessageByID(searchInfo._textChannelID, searchInfo._messageID);
                msg?.delete();

                await message.reply(`${searchInfo._songInformationArr[songIndex]._title}(${searchInfo._songInformationArr[songIndex].getSongDurationString()}) 노래가 추가되었습니다.`, true);
            }
            break;
            case PlayCommandType.PLAYLINKLIST:
            {
                const listID = content.split('list=')[1].split('&')[0];
                const songInfoArr = await YoutubeHelper.queryPlayList(listID);
                const songInfoCount = songInfoArr.length;
                if(songInfoCount == 0)
                {
                    await message.reply("PlayList가 올바르지 않습니다.", true);
                    return;
                }

                for(let i = 0; i < songInfoCount; ++i)
                    this._songList.push(new SongPlayInformation(songInfoArr[i], voiceChannel!.id, textChannelID));

                await message.reply(`총 ${songInfoCount}개의 노래가 추가되었습니다.`, true);
            }
            break;
            case PlayCommandType.PLAYLINKVEDIO:
            {
                const videoID = content.split(`${gYoutubeLinkVideoIDKeyword}=`)[1].split(`&`)[0];

                const titleAndDurationArr = await YoutubeHelper.queryVideoTitleAndDuration([videoID]);
                if(titleAndDurationArr.length == 0)
                {
                    await message.reply(`노래의 Duration을 가져오지 못했습니다. VideoID${videoID}가 올바른지 확인해주세요.`, true);
                    return;
                }

                const songInfo = new SongInformation(videoID, titleAndDurationArr[0]._title, titleAndDurationArr[0]._duration);
                const newSong = new SongPlayInformation(songInfo, voiceChannel!.id, textChannelID);
                this._songList.push(newSong);

                await message.reply(`${newSong._songInformation._title}(${newSong._songInformation.getSongDurationString()}) 노래가 추가되었습니다.`, true);
            }
            break;
            default:
            {
                Logger.error(`비정상적 PlayCommandType(${PlayCommandType})입니다. 개발자에게 알려주세요.`);
                await message.reply(`비정상적 PlayCommandType(${PlayCommandType})입니다. 개발자에게 알려주세요.`, true);
            }
            return;
        }
        
        // 현재 노래 재생중이 아니라면 자동으로 노래 하나를 재생합니다.
        if(this._currentPlayingSongInformation == undefined)
            this.nextSong();
    }

    async skipSongCommand()
    {
        Logger.logDev("MusicPlayer SkipSong");

        this._player?.stop();
    }

    async listSongCommand(message: Message)
    {
        Logger.logDev("MusicPlayer ListSong");

        if(this._songList.length == 0)
            await message.reply("재생목록이 비었습니다.", true);
        else
        {
            let sentence = `Count: ${this._songList.length}` + "```";
            for(let i = 0; i < this._songList.length; ++i){
                let tempString = 
                `${i}. ${this._songList[i]._songInformation._title}(${this._songList[i]._songInformation.getSongDurationString()})\n`;

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

            await message.reply(sentence, true);
        }
    }

    private async randomSongInternal2(count: number, output: {videoIDArr: Array<string>, titleArr: Array<string>, durationArr: Array<number>}, depth: number)
    {
        if(depth > 5)
            return output;

        let videoIDArr = Array.from(this._songRankInformationMap.keys());
        let videoIDCount = videoIDArr.length;
        let percentageArr = Array<number>();
        for(let i = 0; i < videoIDCount; ++i)
        {
            let playCount = this._songRankInformationMap.get(videoIDArr[i]);
            if(playCount == undefined)
                continue;

            for(let j = 0; j < playCount; ++j)
                percentageArr.push(i);
        }

        shuffle(percentageArr);

        let randomVideoIDArr = Array<string>();
        let maxCount = Math.min(videoIDArr.length, count);
        for(let i = 0; i < maxCount; ++i)
        {
            let randomIndex = Math.floor(Math.random() * percentageArr.length);
            let percentIndex = percentageArr[randomIndex];
            let videoID = videoIDArr[percentIndex];

            // 이미 재생목록에 있는 건 추가하지 않는다.
            if(this._songList.find(element => element._songInformation._id == videoID) != undefined)
            {
                Logger.logDev("이미 재생목록에 있어 랜덤목록에 추가하지 않습니다.");
                --i;
                continue;
            }

            // 히스토리 목록에 있던 건 추가하지 않는다.
            if(this._songHistory.indexOf(videoID) != -1)
            {
                Logger.logDev("이미 히스토리에 있어 랜덤목록에 추가하지 않습니다.");
                --i;
                continue;
            }

            // 이미 추가된 건 추가하지 않는다. (중복 추첨된 경우)
            if(randomVideoIDArr.indexOf(videoID) != -1 || output.videoIDArr.indexOf(videoID) != -1)
            {
                Logger.logDev("이미 랜덤목록에 있어 랜덤목록에 추가하지 않습니다.");
                --i;
                continue;
            }

            randomVideoIDArr.push(videoID);
        }

        let randomTitleAndDurationArr = await YoutubeHelper.queryVideoTitleAndDuration(randomVideoIDArr);
        if(randomTitleAndDurationArr.length == 0)
            randomVideoIDArr = [];
        for(let i = 0; i < randomTitleAndDurationArr.length; ++i)
        {
            if(randomTitleAndDurationArr[i]._duration < 60 * 1 || randomTitleAndDurationArr[i]._duration > 60 * 8)
            {
                randomTitleAndDurationArr.splice(i, 1);
                randomVideoIDArr.splice(i, 1);
            }
        }

        let randomTitleArr = Array<string>();
        let randomDurationArr = Array<number>();
        for(let element of randomTitleAndDurationArr)
        {
            randomTitleArr.push(element._title);
            randomDurationArr.push(element._duration);
        }

        output.videoIDArr = output.videoIDArr.concat(randomVideoIDArr);
        output.titleArr = output.titleArr.concat(randomTitleArr);
        output.durationArr = output.durationArr.concat(randomDurationArr);

        // Error에 걸려 개수가 모자른 경우에는 개수를 만족할 수 있도록 재귀호출
        let requestCount = maxCount - randomVideoIDArr.length;
        if(requestCount > 0)
            output = await this.randomSongInternal2(requestCount, output, depth + 1);

        return output;
    }
    private async randomSongInternal(count: number)
    {
        return this.randomSongInternal2(count, {videoIDArr: Array<string>(), titleArr: Array<string>(), durationArr: Array<number>()}, 0);
    }
    async randomSongCommand(message: Message, count: number)
    {
        Logger.logDev("MusicPlayer RandomSong");

        if(this._songRankInformationMap.size == 0)
        {
            await message.reply("노래 랭킹이 없습니다. 음악을 들어주세요.", true);
            return;
        }

        const voiceChannel = message.getVoiceChannel();
        if(this.isValidVoiceChannel(voiceChannel) == false)
        {
            await message.reply("먼저 VoiceChannel에 입장해주세요.", true);
            return;
        }

        const textChannelID = message.getTextChannelID();
        if(textChannelID == undefined)
        {
            await message.reply("Message가 작성된 TextChannel이 없다...? 이거 답장은 가나...?", true);
            return;
        }

        let output = await this.randomSongInternal(count);
        for(let i = 0; i < output.videoIDArr.length; ++i)
        {
            const songInfo = new SongInformation(output.videoIDArr[i], output.titleArr[i], output.durationArr[i]);
            this._songList.push(new SongPlayInformation(songInfo, voiceChannel!.id, textChannelID));
        }

        await message.reply(`${output.videoIDArr.length}개의 랜덤 노래가 추가되었습니다.`, true);

        if(this._currentPlayingSongInformation == undefined)
            this.nextSong();
    }

    async rankSongCommand(message: Message)
    {
        Logger.logDev("MusicPlayer RankSong");

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
            if(titleArr[i] == undefined)
                continue;

            let temp = `${i + 1}. ${titleArr[i]} (${countArr[i]})\n`;
            if(sentence.length + temp.length > 2000)
                break;

            sentence += temp;
        }
        sentence += "```";

        await message.reply(sentence, true);
    }

    async autoRandomPlayCommand(message: Message)
    {
        Logger.logDev("MusicPlayer AutoRandomPlayMode");

        const voiceChannel = message.getVoiceChannel();
        if(this.isValidVoiceChannel(voiceChannel) == false)
        {
            await message.reply("Voicechannel에 먼저 입장해주세요.", true);
            return;
        }

        this._autoRandomPlay = !this._autoRandomPlay;
        if(this._autoRandomPlay == false)
        {
            await message.reply("일반재생 모드로 변경되었습니다.", true);
            return;
        }

        await message.reply("자동재생 모드로 변경되었습니다.", true);

        const textChannelID = message.getTextChannelID();
        if(textChannelID == undefined)
        {
            await message.reply("Message가 작성된 TextChannel이 없다...? 이거 답장은 가나...?", true);
            return;
        }
        
        if(this._currentPlayingSongInformation == undefined)
        {
            let output = await this.randomSongInternal(1);
            for(let i = 0; i < output.videoIDArr.length; ++i)
            {
                const songInfo = new SongInformation(output.videoIDArr[i], output.titleArr[i], output.durationArr[i]);
                this._songList.push(new SongPlayInformation(songInfo, voiceChannel!.id, textChannelID));
            }

            this.nextSong();
        }
    }

    /*
    *   절대 다른 곳에서 쓰지마세요! Play와 Stop의 CallBack 꼬일 수 있습니다.
    */
    private async playSong(songPlayInfo: SongPlayInformation)
    {
        Logger.logDev("MusicPlayer PlaySong");

        this.clearDisconnectTimeout();

        if(this._connection == undefined)
        {
            const guild = this.getGuild();

            this._connection = joinVoiceChannel({
                channelId: songPlayInfo._voiceChannelID, 
                guildId: this._guildID, 
                adapterCreator: guild.voiceAdapterCreator
            });
    
            this._connection.on("error", error => {
                Logger.error("--- CN Error ---\n", error);
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
                this.disconnect();  // 관리자가 억지로 Sona를 '우클릭 연결 끊기'하는 경우
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
            this._player = createAudioPlayer({
                behaviors: {
                    noSubscriber: NoSubscriberBehavior.Play
                }
            });
            this._player.on(AudioPlayerStatus.Idle, (oldState: AudioPlayerState, newState: AudioPlayerState) => {
                Logger.logDev('--- MP State Change ---');

                if(oldState.status == AudioPlayerStatus.Playing && newState.status == AudioPlayerStatus.Idle)
                {
                    const textChannel = this.getTextChannelByID(this._currentPlayingSongInformation!._textChannelID);
                    if(this._currentPlayingSongInformation == undefined)
                    {
                        textChannel?.send(`MP State Change: currentPlayingSongInformation이 없으면 안되는데.. 없는 것으로 추정됩니다. 반드시 개발자에게 통보요망`);
                    }
                    else
                    {
                        const id = this._currentPlayingSongInformation!._songInformation._id;
                        let playCount = this._songRankInformationMap.get(id);
                        if(playCount == undefined)
                            this._songRankInformationMap.set(id, 1);
                        else
                            this._songRankInformationMap.set(id, playCount + 1);
    
                        this._songHistory.enqueue(id);
                    }
                    
                    this.nextSong();
                }
            }).on('error', error => {
                Logger.error('--- MP Error ---\n', error);
            })
            ;

            if(process.env.NODE_ENV !== 'production')
            {
                this._player.on('debug', message => {
                    Logger.logDev("--- MP Debug ---\n", message);
                })
            }
        }

        async function createAudioStream(info: SongPlayInformation)
        {
            // 자체제작
            // {
            //     //https://velog.io/@tan90/youtube-dl
            //     /**
            //      * 1. Video가 있는 Youtube HTML 가져오기
            //      * 2. HTML에서 ytInitialPlayerResponse를 JSON로 만들기
            //      * 3. JSON에서 streamingData.formats로 접근
            //      * 4. 다음 분기를 따른다.
            //      *  4-1. url이 있다면 url을 그냥 GET하면 동영상이 넘어온다.
            //      *  4-2. url이 없는 경우 signatureChiper가 대신 있을 것
            //      *      4-2-1. HTML에 base.js를 보면 복호화 코드가 있다.
            //      *      4-2-2. 이 곳에 signatureChiper을 넣으면 복호화된 URL이 새로나온다.
            //      *      4-2-3. 
            //      */
            //     const html = await (await fetch(`${gYoutubeLink}?${gYoutubeLinkVideoIDKeyword}=Za9pOxEGqWU`)).text();
            //     const matches = html.match(/ytInitialPlayerResponse\s*=\s*({.+?})\s*;\s*(?:var\s+meta|<\/script|\n)/);
            //     const json = JSON.parse(matches![1]);
            //     if('url' in json.streamingData.formats)
            //         Logger.logDev('url: ', json.streamingData.formats.url);
            //     else if('signatureCipher' in json.streamingData.formats)
            //         Logger.logDev('signatureCipher: ', json.streamingData.formats.signatureCipher);
            //     else
            //         Logger.logDev('There is no sourceURL!');

            //     // function decipher(a: any) {
            //     //     var b = {
            //     //         credentials: "include",
            //     //         cache: "no-store"
            //     //     };
            //     //     Object.assign(b, this.Y);
            //     //     this.B && (b.signal = this.B.signal);
            //     //     a = new Request(a,b);
            //     //     fetch(a).then(this.oa, this.onError).then(void 0, gy)
            //     // }

            //     return new Readable();
            // }
                
            // File에서 읽기
            // {
            //     let fs = await import('fs');
            //     const stream = fs.createReadStream('../Sona/resource/cupid.mp3');
            //     return stream;
            // }

            // YTDL
            // {
            //     const url = `${gYoutubeLink}?${gYoutubeLinkVideoIDKeyword}=${info._songInformation._id}`;
            //     const {default: YTDL} = await import(`ytdl-core`);
            //     const stream = await YTDL(url, {
            //         filter: "audioonly", 
            //         quality: "highestaudio", 
            //         highWaterMark: 1 << 25, 
            //     });
            //     return stream;
            // }

            // play-dl
            {
                const url = `${gYoutubeLink}?${gYoutubeLinkVideoIDKeyword}=${info._songInformation._id}`;
                const playDL = await import(`play-dl`);
                const stream = await playDL.stream(url);
                return stream;
            }
        }

        const readStream = await createAudioStream(songPlayInfo);
        const resource = createAudioResource(readStream.stream, {inputType: readStream.type});
        this._connection.subscribe(this._player);
        this._player.play(resource);

        this._currentPlayingSongInformation = songPlayInfo;

        Logger.logDev(`--- Play: ${this._currentPlayingSongInformation._songInformation._title}`);
        const textChannel = this.getTextChannelByID(this._currentPlayingSongInformation._textChannelID);
        textChannel?.send(`${this._currentPlayingSongInformation!._songInformation._title}(${this._currentPlayingSongInformation._songInformation.getSongDurationString()}) 노래를 재생합니다.`);
    }

    private async nextSong()
    {
        Logger.logDev("MusicPlayer NextSong");

        // 재생할 다음 곡이 없으면 그대로 disconnection 예약
        if(this._songList.length == 0)
        {
            if(this._autoRandomPlay == false)
            {
                Logger.logDev("--- MP Reservation Disconnect Timeout")

                this._currentPlayingSongInformation = undefined;
                this._disconnectionTimer = setTimeout(
                    () => {
                        this.disconnect()
                    }, 1000 * gDisconnectTimeoutSecond
                    );
                return;
            }
            else
            {
                const output = await this.randomSongInternal(1);
                for(let i = 0; i < output.videoIDArr.length; ++i)
                {
                    const songInfo = new SongInformation(output.videoIDArr[i], output.titleArr[i], output.durationArr[i]);
                    this._songList.push(new SongPlayInformation(songInfo, this._currentPlayingSongInformation!._voiceChannelID, this._currentPlayingSongInformation!._textChannelID));
                }
            }
        }

        this.playSong(this._songList.shift()!);
    }

    private disconnect()
    {
        Logger.trace("MusicPlayer Disconnect");

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
        Logger.logDev("clearDisconnectTimeout");

        clearTimeout(this._disconnectionTimer);
        this._disconnectionTimer = undefined;
    }

    async shuffleListCommand(message: Message)
    {
        Logger.logDev("ShuffleCommand");

        shuffle(this._songList);
        message.reply(`${this._songList.length}개의 List가 Shuffle되었습니다.`, true);
    }

    async testCommand(message: Message)
    {
    }
}