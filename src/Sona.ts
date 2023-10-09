// https://discordjs.guide/
import DiscordJS from 'discord.js';

import Logger from './Logger'
import {Message, MusicPlayer} from "./MusicPlayer"
import { ChatGPT } from './ChatGPT';
import {CommandPrefix, DiscordToken} from './Token.json';

class DiscordSession
{
    _guildID: DiscordJS.Snowflake;
    _musicPlayer: MusicPlayer;
    _gpt: ChatGPT;
    
    constructor(client: DiscordJS.Client, guildID: string)
    {
        this._guildID = guildID;
        this._musicPlayer = new MusicPlayer(client, guildID);
        this._gpt = new ChatGPT();
    }

    update(deltaTime: number) : void
    {
        this._musicPlayer.update(deltaTime);
    }
}

interface Command extends DiscordJS.ChatInputApplicationCommandData {
    run: (session: DiscordSession, interaction: DiscordJS.CommandInteraction) => void;
}

export default class Sona
{
    _client: DiscordJS.Client;
    _sessionMap: Map<string, DiscordSession>;
    _commandArr: Array<Command>;

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

    private async handleSlashCommand(client: DiscordJS.Client, interaction: DiscordJS.CommandInteraction): Promise<void>
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
                await this.handleSlashCommand(this._client, interaction);
        }).on(DiscordJS.Events.MessageCreate, async (message: DiscordJS.Message) => {
            if(message.author.bot == true)
                return;
            
            Logger.logDev("--- messageCreate ---\n", message);

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
                    case CommandType.TEST:
                        session._musicPlayer.testCommand(newMessage);
                    break;
                    case CommandType.COUNT:
                    default:
                        newMessage.reply(`올바른 명령어를 입력하세요.`, false);
                    break;
                }                
            }
        });
        if(process.env.NODE_ENV !== 'production')
        {
            this._client.on(DiscordJS.Events.MessageUpdate, (oldMessage, newMessage) => {
                if(oldMessage.author!.bot == true || newMessage.author!.bot == true)
                    return;
    
                Logger.logDev("--- Client MessageUpdate ---\n", oldMessage, newMessage);
            }).on(DiscordJS.Events.Debug, message =>{
                Logger.logDev("--- Client Debug ---\n", message);
            });
        }

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
                session._musicPlayer.playCommand(new Message(interaction));
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
                session._musicPlayer.listSongCommand(new Message(interaction));
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
                session._musicPlayer.randomSongCommand(new Message(interaction), 5);
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
                session._musicPlayer.rankSongCommand(new Message(interaction));
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
                session._musicPlayer.autoRandomPlayCommand(new Message(interaction));
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
                session._musicPlayer.shuffleListCommand(new Message(interaction));
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
                const message = new Message(interaction)
                const response = await session._gpt.send(message.getContent());
                message.reply(response!, false);
            }
        }
        const Test: Command = 
        {
            name: "test",
            description: "개발자 Test용 Command입니다.",
            nameLocalizations: {
                "en-US": "test", 
                "ko": "테스트", 
            }, 
            run: async (session: DiscordSession, interaction: DiscordJS.CommandInteraction) => {
                await interaction.deferReply();
                session._musicPlayer.testCommand(new Message(interaction));
            }
        }

        this._commandArr = [PlaySong, SkipSong, ListSong, RandomSong, RankSong, AutoRandomMode, ShuffleList, AskGPT];
    }

    run()
    {
        this._client.login(DiscordToken);
    }

    update(deltaTime: number)
    {
        this._sessionMap.forEach((session, key) => {
            session.update(deltaTime);
        });
    }
}