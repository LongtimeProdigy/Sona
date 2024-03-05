import {ResourcePath, StudyManagerPath, StudyManagerPrefix} from './Token.json';
import DiscordJS from "discord.js"
import Logger from './Logger'
import { FileUtility, TimeUtility } from './Utility';
const schedule = require('node-schedule');  //import schedule from 'node-schedule'

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

    private loadHistory(filePath: string)
    {
        let history = new Map<string, Array<StudyHistory>>
        FileUtility.prepareFilePath(filePath);

        const loadObj = FileUtility.readFileForJSON(filePath);
        let readHistory = new Map(Object.entries(loadObj));

        history = new Map<string, Array<StudyHistory>>;

        // 자꾸 StudyHistory의 멤버가 string타입으로 읽어져서 새로 객체를 만들어 Date타입으로 들어가게한다.
        readHistory.forEach((value, key) => {
            let historyArray = new Array<StudyHistory>();
            (value as []).forEach((value) => {
                let start = value["_start"];
                let end = value["_end"];
                historyArray.push(new StudyHistory(new Date(start), new Date(end)));
            });

            history.set(key, historyArray);
        });

        return history;
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

    private getCurrentHistoryFilePath() : string
    {
        let filePath = `${ResourcePath}/${StudyManagerPath}/${StudyManagerPrefix}_${this._guildID}_TempHistory.json`;
        return filePath;
    }
    private getCurrentStudyFilePath() : string
    {
        let filePath = `${ResourcePath}/${StudyManagerPath}/${StudyManagerPrefix}_${this._guildID}_TempStudy.json`;
        return filePath;
    }
    private writeCurrentSrudyInfo()
    {
        let filePath = this.getCurrentStudyFilePath();
        let sentence = Object.fromEntries(this._currentStudyInfo);
        FileUtility.writeFileForJSON(filePath, sentence);
    }
    // StudyManager의 멤버들을 사용하는 실수를 하지 않기 위해서 일부러 static으로둠
    static saveHistory(filePath: string, history: Map<string, Array<StudyHistory>>)
    {
        let sentence = Object.fromEntries(history);
        FileUtility.writeFileForJSON(filePath, sentence);
    }
    private writeCurrentHistory()
    {
        let filePath = this.getCurrentHistoryFilePath();
        StudyManager.saveHistory(filePath, this._history);
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
    }

    constructor(client: DiscordJS.Client, guildID: string, textChannelID: DiscordJS.Snowflake)
    {
        this._client = client;
        this._guildID = guildID;
        this._textChannelID = textChannelID;
        this._currentStudyInfo = new Map<string, Date>();

        // Temp History
        // 크래시가 나는 경우 데이터를 읽어올 수 있도록
        {
            {
                let filePath = this.getCurrentStudyFilePath();
                FileUtility.prepareFilePath(filePath);
    
                const loadObj = FileUtility.readFileForJSON(filePath);
                let tempCurrentStudyInfo = new Map(Object.entries(loadObj));
    
                // 자꾸 StudyHistory의 멤버가 string타입으로 읽어져서 새로 객체를 만들어 Date타입으로 들어가게한다.
                tempCurrentStudyInfo.forEach((value, key) => {
                    let tempDate = new Date(value as string);
                    this._currentStudyInfo.set(key, tempDate);
                });
            }

            // 봇이 켜져있지 않은 상태에서 시작한 사람들은 봇이 켜지는 시점에서부터라도 시작할 수 있도록
            {
                let guild = this.getGuild();
                guild.members.cache.forEach((member: DiscordJS.GuildMember, key: string) => {
                    if(member.user.bot == true)
                        return;

                    if(member.voice.channel == null)
                        return;
    
                    let userID = member.user.id;
                    let currentInfo = this._currentStudyInfo.get(userID);
                    // 이미 temp에서 읽어온 사람은 굳이 지금부터 채킹하지 않아도된다.
                    if(currentInfo == undefined)
                    {
                        this.startStudy(member.user);
                    }
                });
            }
        }


        // History
        {
            let filePath = this.getCurrentHistoryFilePath();
            this._history = this.loadHistory(filePath);
        }

        // Alram
        {
            // Daily Alarm
            const alramDaily = schedule.scheduleJob('55 59 5 * * *', async () => {
                let sentence = await this.makeRanking(" Daily");
                this.getTextChannel()?.send(sentence);
            });

            // Change Weekly
            const changeWeekly = schedule.scheduleJob('0 0 6 * * MON', async () => {
                // weekly alarm
                {
                    let sentence = await this.makeRanking(" Weekly");
                    this.getTextChannel()?.send(sentence);
                }

                // 현재 공부중인 사람이 있다면 지금 시간을 기점으로 History에 저장
                {
                    let endTime = new Date();
                    let newStartTime = endTime;
                    newStartTime.setSeconds(newStartTime.getSeconds() + 1);
                    let tempCurrentInfo = new Map<string, Date>;
                    this._currentStudyInfo.forEach((start: Date, userID: string) => {
                        this.moveCurrentStudyToHistory(userID, start, endTime);
                        tempCurrentInfo.set(userID, newStartTime);
                    });
                    this._currentStudyInfo = tempCurrentInfo;
                    this.writeCurrentSrudyInfo();
                }

                // 현재 History는 저장 후에 초기화
                {
                    function getWeekNumber(currentDate = new Date(), dowOffset = 0) {
                        /*getWeekNumber() was developed by Nick Baicoianu at MeanFreePath: http://www.meanfreepath.com */
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

                    let weekNumber = getWeekNumber();
                    let filePath = `${ResourcePath}/${StudyManagerPath}/${StudyManagerPrefix}_${this._guildID}_${weekNumber}.json`;

                    StudyManager.saveHistory(filePath, this._history);
                    // 주마다 초기화 (makeRanking에서 쓰이기때문에 뒤에 있어야함)
                    this._history.clear();
                }
            });
        }
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
        let start = this._currentStudyInfo.get(user.id);
        if(start == undefined)
            return;
        
        let end = new Date();
        const textChannel = this.getTextChannel();
        if(textChannel != undefined)
        {
            let milli = end.getTime() - start.getTime();
            textChannel.send(`${user.username}님께서 스터디를 종료하였습니다.(${TimeUtility.convertMillisecondToDigitalString(milli)}분)`);
        }

        this.moveCurrentStudyToHistory(user.id, start, end);

        this.writeCurrentSrudyInfo();
        this.writeCurrentHistory();
    }

    async makeRanking(prefix: string)
    {
        let sentence = "";
        if(this._history.size == 0)
        {
            sentence += "해당 주차에 스터디를 시작한 사람이 없습니다."
            return sentence;
        }

        let rank = new Array<RankInformation>();
        for(const [userID, history] of this._history)
        {
            let totalTime = 0;
            history.forEach((history: StudyHistory) => {
                totalTime += (history._end.getTime() - history._start.getTime());
            });

            let user = await this._client.users.fetch(userID);
            let userName = user.username;
            rank.push(new RankInformation(userName, totalTime));
        }

        rank.sort((lhs: RankInformation, rhs: RankInformation) => {
            return rhs._time - lhs._time;
        });

        sentence += `★${prefix} `;
        sentence += "Study Ranking ★```\n· 누적 시간은 매주 월요일 오전 6시에 초기화됩니다.\n\n";
        rank.forEach((rank: RankInformation, index: number) => {
            let temp = `${index + 1}. ${rank._userName} (${TimeUtility.convertMillisecondToDigitalString(rank._time)}분)\n`;
            if(sentence.length + temp.length > 2000)
                return;

            sentence += temp;
        });
        sentence += "```";

        return sentence;
    }
}