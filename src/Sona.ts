// https://discordjs.guide/
// https://namu.wiki/w/discord.js
import DiscordJS, { DiscordjsError, TextChannel } from 'discord.js';

import Logger from './Logger'
import {Message, MusicPlayer} from "./MusicPlayer"
import { ChatGPT } from './ChatGPT';
import { Gemini } from './Gemini';
import {CommandPrefix, DiscordToken} from './Token.json';
import {exec, ExecException, spawn} from 'child_process';
import {StudyManager} from "./StudyManager"

class DiscordSession
{
    _guildID: DiscordJS.Snowflake;
    _musicPlayer: MusicPlayer;
    _gpt: ChatGPT;
    _gemini: Gemini;
    _studyManager: StudyManager | undefined;
    
    constructor(client: DiscordJS.Client, guildID: string)
    {
        this._guildID = guildID;
        this._musicPlayer = new MusicPlayer(client, guildID);
        this._gpt = new ChatGPT();
        this._gemini = new Gemini();
        this._studyManager = undefined;
    }

    startStudyManager(client: DiscordJS.Client, guildID: string, textChannelID: DiscordJS.Snowflake)
    {
        if(this._studyManager != undefined)
            return;

        this._studyManager = new StudyManager(client, guildID, textChannelID);
    }

    update(deltaTime: number) : void
    {
        this._musicPlayer.update(deltaTime);
    }
}

interface Command extends DiscordJS.ChatInputApplicationCommandData {
    run: (session: DiscordSession, interaction: DiscordJS.ChatInputCommandInteraction) => void;
}

export default class Sona
{
    _client: DiscordJS.Client;
    _sessionMap: Map<string, DiscordSession>;
    _commandArr: Array<Command>;

    _palWorldServerTextChannelID: string;

    private getSession(guildID: DiscordJS.Snowflake) : DiscordSession
    {
        let session = this._sessionMap.get(guildID);
        if(!session)
        {
            this._sessionMap.set(guildID, new DiscordSession(this._client, guildID));
            session = this._sessionMap.get(guildID)!;
        }

        return session;
    }

    private async handleSlashCommand(client: DiscordJS.Client, interaction: DiscordJS.ChatInputCommandInteraction): Promise<void>
    {
        const slashCommand = this._commandArr.find(c => c.name === interaction.commandName);
        if (!slashCommand) {
            interaction.followUp({ content: "An error has occurred" });
            return;
        }

        if(!interaction.guildId)
        {
            interaction.followUp({ content: "An error has occurred on discord. no guildID in interaction" });
            return;
        }

        const session = this.getSession(interaction.guildId);
        slashCommand.run(session, interaction);
    };

    constructor()
    {
        this._palWorldServerTextChannelID = "";

        this._sessionMap = new Map<string, DiscordSession>();
        this._client = new DiscordJS.Client({
            intents: [
                DiscordJS.GatewayIntentBits.Guilds, 
                DiscordJS.GatewayIntentBits.GuildVoiceStates, 
                DiscordJS.GatewayIntentBits.GuildMessages, 
                DiscordJS.GatewayIntentBits.MessageContent, 
            ], 
            partials: [
                DiscordJS.Partials.Channel, 
                DiscordJS.Partials.Message, 
            ]
        }).on(DiscordJS.Events.ClientReady, async () => {
            if (!this._client.user || !this._client.application)
                return;

            await this._client.application.commands.set(this._commandArr);
            Logger.log(`${this._client.user.username} is online`);
        }).on(DiscordJS.Events.InteractionCreate, async (interaction: DiscordJS.Interaction) => {
            if (interaction.isCommand() || interaction.isContextMenuCommand())
                await this.handleSlashCommand(this._client, interaction as DiscordJS.ChatInputCommandInteraction);
        }).on(DiscordJS.Events.MessageCreate, async (message: DiscordJS.Message) => {
            if(message.author.bot == true)
                return;
            
            //Logger.logDev("--- messageCreate ---\n", message);

            if(message.guildId == null)
                return;

            if(message.content.startsWith(CommandPrefix) == true)
            {
                enum CommandType
                {
                    PLAY, 
                    SKIP, 
                    LIST, 
                    RANDOM, 
                    RANK,
                    AUTORANDOMMODE, 
                    CHATGPT, 
                    GEMINI, 
                    TEST,  
                    COUNT, 
                }
                function getCommandType()
                {
                    if(message.content.startsWith(`${CommandPrefix}s`) || message.content.startsWith(`${CommandPrefix}S`) || message.content.startsWith(`${CommandPrefix}ㄴ`))
                        return CommandType.SKIP;
                    else if(message.content.startsWith(`${CommandPrefix}l`) || message.content.startsWith(`${CommandPrefix}L`) || message.content.startsWith(`${CommandPrefix}ㅣ`))
                        return CommandType.LIST;
                    else if(message.content.startsWith(`${CommandPrefix}p `) || message.content.startsWith(`${CommandPrefix}P `) || message.content.startsWith(`${CommandPrefix}ㅔ `) || isNaN(Number(message.content.slice(1))) == false)
                        return CommandType.PLAY;
                    else if(message.content.startsWith(`${CommandPrefix}random`) || message.content.startsWith(`${CommandPrefix}Random`) || message.content.startsWith(`${CommandPrefix}랜덤`))
                        return CommandType.RANDOM;
                    else if(message.content.startsWith(`${CommandPrefix}r`) || message.content.startsWith(`${CommandPrefix}R`) || message.content.startsWith(`${CommandPrefix}ㄱ`))
                        return CommandType.RANK;
                    else if(message.content.startsWith(`${CommandPrefix}AutoRandomMode`))
                        return CommandType.AUTORANDOMMODE;
                    else if(message.content.startsWith(`${CommandPrefix}gpt`))
                        return CommandType.CHATGPT;
                    else if(message.content.startsWith(`${CommandPrefix}gemini`))
                        return CommandType.GEMINI;
                    else if(message.content.startsWith(`${CommandPrefix}test`))
                        return CommandType.TEST;
                    else
                        return CommandType.COUNT;
                }

                const newMessage = new Message(message);
                const session = this.getSession(message.guildId);
                const commandType = getCommandType();
                switch (commandType) {
                    case CommandType.PLAY:
                        session._musicPlayer.playCommand(newMessage);
                    break;
                    case CommandType.SKIP:
                        session._musicPlayer.skipSongCommand();
                    break;
                    case CommandType.LIST:
                        session._musicPlayer.listSongCommand(newMessage);
                    break;
                    case CommandType.RANDOM:
                        session._musicPlayer.randomSongCommand(newMessage, 5);
                    break;
                    case CommandType.RANK:
                        session._musicPlayer.rankSongCommand(newMessage);
                    break;
                    case CommandType.AUTORANDOMMODE:
                        session._musicPlayer.autoRandomPlayCommand(newMessage);
                    break;
                    case CommandType.CHATGPT:
                    {
                        const sentence = newMessage.getContent();
                        const response = await session._gpt.send(sentence);
                        newMessage.reply(response!, false);
                    }
                    break;
                    case CommandType.GEMINI:
                    {
                        const sentence = newMessage.getContent();
                        const response = await session._gemini.send(sentence);
                        newMessage.reply(response!, false);
                    }
                    break;
                    case CommandType.TEST:
                        session._musicPlayer.testCommand(newMessage);
                    break;
                    case CommandType.COUNT:
                    default:
                        newMessage.reply(`올바른 명령어를 입력하세요.`, false);
                    break;
                }                
            }
        }).on(DiscordJS.Events.VoiceStateUpdate, (oldState: DiscordJS.VoiceState, newState:DiscordJS.VoiceState) => {
            let session = this.getSession(newState.guild.id);
            if(session._studyManager == undefined)
                return;

            if(oldState.member!.user.bot == true)
                return;

            if(oldState.channel == null && newState.channel != null)
            {
                session._studyManager.startStudy(oldState.member!.user);
            }
            else if(oldState.channel != null && newState.channel == null)
            {
                session._studyManager.endStudy(oldState.member!.user);
            }
        });
        // if(process.env.NODE_ENV !== 'production')
        // {
        //     this._client.on(DiscordJS.Events.MessageUpdate, (oldMessage, newMessage) => {
        //         if(oldMessage.author!.bot == true || newMessage.author!.bot == true)
        //             return;
    
        //         Logger.logDev("--- Client MessageUpdate ---\n", oldMessage, newMessage);
        //     }).on(DiscordJS.Events.Debug, message =>{
        //         Logger.logDev("--- Client Debug ---\n", message);
        //     });
        // }

        const PlaySong: Command = {
            name: "p",
            description: "노래를 재생합니다. [검색할 Keyword], [재생할 곡 숫자, Youtube 링크]",
            type: DiscordJS.ApplicationCommandType.ChatInput,
            nameLocalizations: {
                "en-US": "p", 
                "ko": "ㅔ", 
            }, 
            options: [
                {
                    type: DiscordJS.ApplicationCommandOptionType.String,
                    name: 'content',
                    description: '입력값',
                    required: true,
                },
            ],
            run: async (session: DiscordSession, interaction: DiscordJS.CommandInteraction) => 
            {
                await interaction.deferReply();
                session._musicPlayer.playCommand(new Message(interaction as DiscordJS.ChatInputCommandInteraction));
            }
        };
        const SkipSong: Command = {
            name: "s",
            description: "현재 노래를 Skip하거나 List에 있는 노래를 제거합니다.",
            type: DiscordJS.ApplicationCommandType.ChatInput,
            nameLocalizations: {
                "en-US": "s", 
                "ko": "ㄴ", 
            }, 
            options: [
                {
                    type: DiscordJS.ApplicationCommandOptionType.String,
                    name: 'content',
                    description: '건너뛸 노래 번호를 입력합니다. [번호]~[번호] 입력시 여러개를 건너뜁니다. 번호가 없으면 현재곡을 건너뜁니다.',
                    required: false,
                },
            ],
            run: async (session: DiscordSession, interaction: DiscordJS.CommandInteraction) => {
                await interaction.deferReply();
                await interaction.followUp({content: "현재 노래를 스킵합니다."});
                session._musicPlayer.skipSongCommand();
            }
        };
        const ListSong: Command = {
            name: "l",
            description: "현재 재생목록을 출력합니다.",
            nameLocalizations: {
                "en-US": "l", 
                "ko": "ㅣ", 
            }, 
            run: async (session: DiscordSession, interaction: DiscordJS.CommandInteraction) => {
                await interaction.deferReply();
                session._musicPlayer.listSongCommand(new Message(interaction as DiscordJS.ChatInputCommandInteraction));
            }
        }
        const RandomSong: Command = {
            name: "random",
            description: "Rank 순위 가중치에 따라 재생목록에 있는 건 제외하고 5개를 뽑습니다.",
            nameLocalizations: {
                "en-US": "random", 
                "ko": "랜덤", 
            }, 
            run: async (session: DiscordSession, interaction: DiscordJS.CommandInteraction) => {
                await interaction.deferReply();
                session._musicPlayer.randomSongCommand(new Message(interaction as DiscordJS.ChatInputCommandInteraction), 5);
            }
        }
        const RankSong: Command = {
            name: "r",
            description: "많이 들은 음악 순서를 출력합니다.",
            nameLocalizations: {
                "en-US": "r", 
                "ko": "ㄱ", 
            }, 
            run: async (session: DiscordSession, interaction: DiscordJS.CommandInteraction) => {
                await interaction.deferReply();
                session._musicPlayer.rankSongCommand(new Message(interaction as DiscordJS.ChatInputCommandInteraction));
            }
        }
        const AutoRandomMode: Command = {
            name: "a",
            description: "소나가 재생할 목록이 없으면 랜덤으로 노래를 재생합니다.",
            nameLocalizations: {
                "en-US": "a", 
                "ko": "ㅁ", 
            }, 
            run: async (session: DiscordSession, interaction: DiscordJS.CommandInteraction) => {
                await interaction.deferReply();
                session._musicPlayer.autoRandomPlayCommand(new Message(interaction as DiscordJS.ChatInputCommandInteraction));
            }
        }
        const ShuffleList: Command = 
        {
            name: "shuffle",
            description: "소나가 재생할 목록에 있는 노래를 Shuffle합니다. (무작위로 섞습니다)",
            nameLocalizations: {
                "en-US": "shuffle", 
                "ko": "셔플", 
            }, 
            run: async (session: DiscordSession, interaction: DiscordJS.CommandInteraction) => {
                await interaction.deferReply();
                session._musicPlayer.shuffleListCommand(new Message(interaction as DiscordJS.ChatInputCommandInteraction));
            }
        }
        const AskGPT: Command = {
            name: "gpt",
            description: "GPT에게 질문합니다.",
            nameLocalizations: {
                "en-US": "gpt", 
                "ko": "지피티", 
            }, 
            options: [
                {
                    type: DiscordJS.ApplicationCommandOptionType.String,
                    name: 'content',
                    description: '입력값',
                    required: true,
                },
            ],
            run: async (session: DiscordSession, interaction: DiscordJS.CommandInteraction) => {
                await interaction.deferReply();
                const message = new Message(interaction as DiscordJS.ChatInputCommandInteraction)
                const response = await session._gpt.send(message.getContent());
                message.reply(response!, false);
            }
        }
        const AskGemini: Command = {
            name: "gemini",
            description: "Gemini에게 질문합니다.",
            nameLocalizations: {
                "en-US": "gemini", 
                "ko": "잼미니", 
            }, 
            options: [
                {
                    type: DiscordJS.ApplicationCommandOptionType.String,
                    name: 'content',
                    description: 'question',
                    required: true,
                },
            ],
            run: async (session: DiscordSession, interaction: DiscordJS.CommandInteraction) => {
                await interaction.deferReply();
                const message = new Message(interaction as DiscordJS.ChatInputCommandInteraction)
                const response = await session._gemini.send(message.getContent());
                message.reply(response!, false);
            }
        }
        const PalWorldServerStart: Command = {
            name: "pal_start",
            description: "PalWorld 서버를 시작합니다.",
            nameLocalizations: {
                "en-US": "ps", 
            }, 
            run: async (session: DiscordSession, interaction: DiscordJS.CommandInteraction) => {
                await interaction.deferReply();
                
                const message = new Message(interaction as DiscordJS.ChatInputCommandInteraction);
                const targetChannel = this.getTargetVoidChannel();
                if(targetChannel == undefined)
                {
                    message.reply("VoidChannel을 찾을 수 없습니다. 개발자를 찾아주세요.", true);
                    return;
                }
                if(targetChannel.members.size == 0)
                {
                    message.reply("VoiceChannel(노가리)에 입장해야만 열 수 있습니다.", true);
                    return;
                }

                let pid = await this.findPalWorldServerPID();
                if(pid != -1)
                {
                    message.reply("이미 PalWorld Server가 구동중입니다.", true);
                    return;
                }

                this._palWorldServerTextChannelID = message.getTextChannelID()!;
                spawn('C:/Program Files (x86)/Steam/steamapps/common/PalServer/PalServer.exe');

                message.reply("PalWorldServer 구동이 시작되었습니다.", true);
            }
        };
        const PalWorldServerEnd: Command = {
            name: "pal_end",
            description: "PalWorld 서버를 종료합니다.",
            nameLocalizations: {
                "en-US": "pe", 
            }, 
            run: async (session: DiscordSession, interaction: DiscordJS.CommandInteraction) => {
                await interaction.deferReply();
                
                const message = new Message(interaction as DiscordJS.ChatInputCommandInteraction);
                
                const success = await this.killPalWorldServer();
                if(success)
                {
                    message.reply("PalWorldServer가 성공적으로 종료되었습니다.", true);
                }
                else
                {
                    message.reply("PalWorld Server를 먼저 실행해야합니다.", true);
                }
            }
        };
        const InitializeStudy: Command = 
        {
            name: "study",
            description: "Study Timer를 시작할 채널에서 활용해주세요.",
            nameLocalizations: {
                "en-US": "study", 
                "ko": "스터디", 
            }, 
            run: async (session: DiscordSession, interaction: DiscordJS.CommandInteraction) => {
                await interaction.deferReply();

                session.startStudyManager(this._client, session._guildID, interaction.channelId);

                const message = new Message(interaction as DiscordJS.ChatInputCommandInteraction);
                message.reply("StudyTimer가 시작되었습니다.", true);
            }
        }
        const ShowStudyRank: Command = 
        {
            name: "studyrank",
            description: "Study Ranking을 표시합니다.",
            nameLocalizations: {
                "en-US": "sr", 
                "ko": "스터디랭킹", 
            }, 
            run: async (session: DiscordSession, interaction: DiscordJS.CommandInteraction) => {
                await interaction.deferReply();

                const message = new Message(interaction as DiscordJS.ChatInputCommandInteraction);
                if(session._studyManager == undefined)
                {
                    message.reply("스터디를 하고자 하는 채널이 아닙니다.", true);
                    return;
                }

                let sentence = await session._studyManager.makeRanking(" ");
                message.reply(sentence, true);
            }
        }
        const Test: Command = 
        {
            name: "test",
            description: "개발자 Test용 Command입니다.",
            nameLocalizations: {
                "en-US": "sonatest", 
                "ko": "테스트", 
            }, 
            run: async (session: DiscordSession, interaction: DiscordJS.CommandInteraction) => {
                await interaction.deferReply();
                const message = new Message(interaction as DiscordJS.ChatInputCommandInteraction);
                message.reply("TEST", true);
            }
        }

        this._commandArr = [PlaySong, SkipSong, ListSong, RandomSong, RankSong, AutoRandomMode, ShuffleList, InitializeStudy, ShowStudyRank, AskGemini, Test];
    }

    getTargetVoidChannel() : DiscordJS.VoiceBasedChannel | undefined
    {
        const targetChannel = this._client.channels.cache.get("393023869155540994");
        if(targetChannel == undefined)
            return undefined;

        return (targetChannel as DiscordJS.VoiceBasedChannel);
    }
    async findPalWorldServerPID() : Promise<number>
    {
        return new Promise(async (resolve, reject) => {
            await exec('tasklist', (error: ExecException | null, stdout: string, stderr: string) => {
                let lines = stdout.toString().split('\n');
                lines.forEach((line) => {
                    let parts = line.split('=');
                    parts.forEach((items) => {
    
                        const processName = "PalServer-Win64-Test-Cmd";

                        //console.log(items);
    
                        if(items.toString().indexOf(processName) > -1){
                            const pidStr = items.toString().substring(processName.length + 1, items.toString().indexOf("Console")).trim();
                            const pid = Number(pidStr);
                            //console.log('find', pid);
                            resolve(pid);
                        }
                    });
                });

                resolve(-1);
            });
        });
    }
    async killPalWorldServer() : Promise<boolean>
    {
        const pid = await this.findPalWorldServerPID();
        if(pid == -1)
            return false;

        await process.kill(pid);

        return true;
    }

    run()
    {
        this._client.login(DiscordToken);
    }

    async update(deltaTime: number)
    {
        {
            this._sessionMap.forEach(async (session, key) => {
                session.update(deltaTime);
            });
        }

        // PalWorldServer 관련 임시 코드. PalWorld 안하게되면 삭제해야함
        {
            const targetChannel = this.getTargetVoidChannel();
            if(targetChannel == undefined)
                return;
        
            let tempID = this._palWorldServerTextChannelID;
            if(this._palWorldServerTextChannelID != "" && targetChannel.members.size == 0)
            {
                this._palWorldServerTextChannelID = "";
    
                const success = await this.killPalWorldServer();
                if(success)
                {
                    (this._client.channels.cache.get(tempID) as TextChannel).send("채널에 아무도 남아있지 않아 PalWorldServer를 종료합니다.");
                }
            }
        }
    }
}