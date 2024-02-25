import {ResourcePath, StudyManagerPath, StudyManagerPrefix} from './Token.json';
import DiscordJS, { GuildWidgetStyle, MembershipScreeningFieldType, UserFlagsBitField, VoiceChannel } from "discord.js"
import Logger from './Logger'
import { FileHelper } from './Utility';
import {Message} from "./MusicPlayer"
import { lookupService } from 'dns';
import { write } from 'fs';
//import schedule from 'node-schedule'
const schedule = require('node-schedule');

class StudyHistory
{
    _start: Date;
    _end: Date;

    constructor(start: Date, end: Date)
    {
        this._start = start;
        this._end = end;
    }
}

function getFilePath(guildID: string) : string
{
    function getWeek(dowOffset = 0) {
    /*getWeek() was developed by Nick Baicoianu at MeanFreePath: http://www.meanfreepath.com */
        let currentDate = new Date();

        dowOffset = typeof(dowOffset) == 'number' ? dowOffset : 0; //default dowOffset to zero
        let newYear = new Date(currentDate.getFullYear(),0,1);
        let day = newYear.getDay() - dowOffset; //the day of week the year begins on
        day = (day >= 0 ? day : day + 7);
        let daynum = Math.floor((currentDate.getTime() - newYear.getTime() - (currentDate.getTimezoneOffset()-newYear.getTimezoneOffset())*60000)/86400000) + 1;
        let weeknum;
        //if the year starts before the middle of a week
        if(day < 4) {
            weeknum = Math.floor((daynum+day-1)/7) + 1;
            if(weeknum > 52) {
                let nYear = new Date(currentDate.getFullYear() + 1,0,1);
                let nday = nYear.getDay() - dowOffset;
                nday = nday >= 0 ? nday : nday + 7;
                /*if the next year starts before the middle of
                    the week, it is week #1 of that year*/
                weeknum = nday < 4 ? 1 : 53;
            }
        }
        else {
            weeknum = Math.floor((daynum+day-1)/7);
        }
        return weeknum;
    };
    let week = getWeek();
    let filePath = `${ResourcePath}/${StudyManagerPath}/${StudyManagerPrefix}_${week}_${guildID}.json`;
    return filePath;
}
function getTempFilePath(guildID: string) : string
{
    let filePath = `${ResourcePath}/${StudyManagerPath}/${StudyManagerPrefix}_Temp_${guildID}.json`;
    return filePath;
}

function convertUTCtoTime(second: number)
{
    let secondTime = second / 1000;
    let hours = Math.floor(secondTime / 3600);
    let minutes = Math.floor((secondTime - hours * 3600) / 60);
    let seconds = secondTime % 60;

    let ret = "";
    if(hours > 0)
        ret += "" + hours + ":" + (minutes < 10 ? "0" : "");
    ret += "" + minutes + ":" + (seconds < 10 ? "0" : "");
    ret += "" + seconds;

    return ret;
}

class RankInformation
{
    _userName: string;
    _time: number;

    constructor(userName: string, time: number)
    {
        this._userName = userName;
        this._time = time;
    }
}

export class StudyManager
{
    _client: DiscordJS.Client;
    _guildID: string;
    _textChannelID: DiscordJS.Snowflake;

    _history: Map<string, Array<StudyHistory>>; //key: userID
    _currentStudyInfo: Map<string, Date>; //key: userID, value: startDate

    constructor(client: DiscordJS.Client, guildID: string, textChannelID: DiscordJS.Snowflake)
    {
        this._client = client;
        this._guildID = guildID;
        this._textChannelID = textChannelID;
        this._currentStudyInfo = new Map<string, Date>();

        // Temp History
        // 크래시가 나는 경우 데이터를 읽어올 수 있도록
        {
            let filePath = getTempFilePath(this._guildID);
            FileHelper.prepareFilePath(filePath);

            const loadObj = FileHelper.readFileForJSON(filePath);
            let tempCurrentStudyInfo = new Map(Object.entries(loadObj));

            // 자꾸 StudyHistory의 멤버가 string타입으로 읽어져서 새로 객체를 만들어 Date타입으로 들어가게한다.
            tempCurrentStudyInfo.forEach((value, key) => {
                let tempDate = new Date(value as string);
                this._currentStudyInfo.set(key, tempDate);
            });
        }

        // History
        {
            let filePath = getFilePath(this._guildID);
            FileHelper.prepareFilePath(filePath);

            const loadObj = FileHelper.readFileForJSON(filePath);
            let readHistory = new Map(Object.entries(loadObj));

            this._history = new Map<string, Array<StudyHistory>>;

            // 자꾸 StudyHistory의 멤버가 string타입으로 읽어져서 새로 객체를 만들어 Date타입으로 들어가게한다.
            readHistory.forEach((value, key) => {
                let historyArray = new Array<StudyHistory>();
                (value as []).forEach((value) => {
                    let start = value["_start"];
                    let end = value["_end"];
                    historyArray.push(new StudyHistory(new Date(start), new Date(end)));
                });

                this._history.set(key, historyArray);
            });
        }

        // Alram
        {
            // Daily (매일 오전 7시)
            const alramDaily = schedule.scheduleJob('* * * 7 * *', () => {
                this.showRanking(undefined, "Daily");
            });

            // Weekly (매일 오전 7시 10분)
            const alramWeekly = schedule.scheduleJob('10 * * 7 * MON', () => {
                let tempCurrentInfo = new Map<string, Date>;
                this._currentStudyInfo.forEach((start: Date, userID: string) => {
                    let end = new Date();
                    this.moveCurrentStudyToHistory(userID, start, end);
                    tempCurrentInfo.set(userID, end);
                });
                this._currentStudyInfo = tempCurrentInfo;
                this.writeCurrentSrudyInfo();
                this.writeHistory();
                
                this.showRanking(undefined, "Weekly");
            });
        }
    }

    private getUserName(userID: string) : string | undefined
    {
        let user = this._client.users.cache.get(userID);
        return user?.tag;
    }

    private getGuild() : DiscordJS.Guild
    {
        const guild = this._client.guilds.cache.get(this._guildID);
        if(guild == undefined)
            Logger.error(`사라진 Guild의 Session은 존재하면 안됩니다!! 반드시 수정해야함!`);

        return guild!;
    }
    private getTextChannel() : DiscordJS.TextChannel | undefined
    {
        const guild = this.getGuild();
        const textChannel = guild.channels.cache.get(this._textChannelID);
        if(textChannel?.isTextBased() == false)
            return undefined;

        return textChannel as DiscordJS.TextChannel;
    }

    private writeCurrentSrudyInfo()
    {
        let filePath = getTempFilePath(this._guildID);
        let sentence = Object.fromEntries(this._currentStudyInfo);
        FileHelper.writeFileForJSON(filePath, sentence);
    }
    private writeHistory()
    {
        let filePath = getFilePath(this._guildID);
        let sentence = Object.fromEntries(this._history);
        FileHelper.writeFileForJSON(filePath, sentence);
    }

    private moveCurrentStudyToHistory(userID: string, start: Date, end: Date)
    {
        this._currentStudyInfo.delete(userID);

        let newHistory = new StudyHistory(start, end);
        let userHistory = this._history.get(userID);
        if(userHistory == undefined)
        {
            // 처음 스터디를 완료한 사람
            let newHistoryArray = new Array(newHistory);
            this._history.set(userID, newHistoryArray);
        }
        else
        {
            // 이미 스터디를 한 번 해본사람
            userHistory.push(newHistory);
        }

        this.writeCurrentSrudyInfo();
    }

    startStudy(user: DiscordJS.User)
    {
        let start = new Date();
        const textChannel = this.getTextChannel();
        if(textChannel != undefined)
        {
            textChannel.send(`${user.username}님께서 스터디에 참여하였습니다.`);
        }

        this._currentStudyInfo.set(user.id, start);

        this.writeCurrentSrudyInfo();
    }
    endStudy(user: DiscordJS.User)
    {
        let start = this._currentStudyInfo.get(user.id)!;
        let end = new Date();
        const textChannel = this.getTextChannel();
        if(textChannel != undefined)
        {
            let duration = end.getTime() - start.getTime();
            textChannel.send(`${user.username}님께서 스터디를 종료하였습니다. 스터디시간: ${convertUTCtoTime(duration)}`);
        }

        this.moveCurrentStudyToHistory(user.id, start, end);

        this.writeCurrentSrudyInfo();
        this.writeHistory();
    }

    private showRaningInternal(rank: Array<RankInformation>, prefix: string)
    {
        let sentence = "";
        if(this._history.size == 0)
        {
            sentence += "스터디를 시작한 사람이 없습니다."
        }
        else
        {    
            rank.sort((lhs: RankInformation, rhs: RankInformation) => {
                return lhs._time - rhs._time;
            });
    
            sentence += `★${prefix}`;
            sentence += " Study Ranking ★```\n· 누적 시간은 매주 월요일에 초기화됩니다.\n· 한 주가 지난 시점이면 스터디 종료날짜가 기준입니다.\n\n";
            rank.forEach((rank: RankInformation, index: number) => {
                let temp = `${index + 1}. ${rank._userName} (${convertUTCtoTime(rank._time)} 초)\n`;
                if(sentence.length + temp.length > 2000)
                    return;
    
                sentence += temp;
            });
            sentence += "```";
        }

        return sentence;
    }
    showRanking(message: Message | undefined, prefix: string)
    {
        let rank = new Array<RankInformation>();
        this._history.forEach((historyArr: Array<StudyHistory>, userID: string) => {
            let totalTime = 0;
            historyArr.forEach((history: StudyHistory) => {
                totalTime += (history._end.getTime() - history._start.getTime());
            })

            let userName = this.getUserName(userID)!;
            rank.push(new RankInformation(userName, totalTime));
        });

        let sentence = this.showRaningInternal(rank, prefix);

        if(message == undefined)
            this.getTextChannel()?.send(sentence);
        else
            message.reply(sentence, true);
    }
}