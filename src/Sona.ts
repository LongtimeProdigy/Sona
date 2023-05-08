// https://discordjs.guide/
import DiscordJS from 'discord.js';

import Logger from './Logger'
import {Message, MusicPlayer} from "./MusicPlayer"
import {CommandPrefix, DiscordToken} from './Token.json';

class DiscordSession
{
    _musicPlayer: MusicPlayer;
    
    constructor(guildID: string)
    {
        this._musicPlayer = new MusicPlayer(guildID);
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

    private getSession(message: Message)
    {
        let session = this._sessionMap.get(message.getGuildID())!;
        if(!session)
        {
            let guildID = message.getGuildID();
            this._sessionMap.set(message.getGuildID(), new DiscordSession(guildID));
            session = this._sessionMap.get(guildID)!;
        }

        return session;
    }

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
        });

        this._client.on(DiscordJS.Events.ClientReady, async () => {
            if (!this._client.user || !this._client.application)
                return;

            await this._client.application.commands.set(this._commandArr);
            Logger.log(`${this._client.user.username} is online`);
        });

        this._client.on(DiscordJS.Events.InteractionCreate, async (interaction: DiscordJS.Interaction) => {
            if (interaction.isCommand() || interaction.isContextMenuCommand())
                await this.handleSlashCommand(this._client, interaction);
        });

        this._client.on("messageCreate", (message: DiscordJS.Message) => {
            if(message.author.bot == true)
                return;
            
            Logger.logDev("--- messageCreate ---\n", message);

            if(message.content.startsWith(CommandPrefix) == true)
            {
                enum CommandType
                {
                    PLAY, 
                    SKIP, 
                    LIST, 
                    RANDOM, 
                    RANK,
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
                    else if(message.content.startsWith(`${CommandPrefix}test`))
                        return CommandType.TEST;
                    else
                        return CommandType.COUNT;
                }

                let newMessage = new Message(message);
                let session = this.getSession(newMessage);
                const commandType = getCommandType();
                switch (commandType) {
                    case CommandType.PLAY:
                        session._musicPlayer.playCommand(new Message(message));
                    break;
                    case CommandType.SKIP:
                        session._musicPlayer.skipSong();
                    break;
                    case CommandType.LIST:
                        session._musicPlayer.listSong(newMessage);
                    break;
                    case CommandType.RANDOM:
                        session._musicPlayer.randomSong(newMessage);
                    break;
                    case CommandType.RANK:
                        session._musicPlayer.rankSong(newMessage);
                    break;
                    case CommandType.TEST:
                        session._musicPlayer.test(newMessage);
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
            this._client.on("messageUpdate", (oldMessage, newMessage) => {
                if(oldMessage.author!.bot == true)
                    return;
                else if(newMessage.author!.bot == true)
                    return;
    
                Logger.logDev("--- MessageUpdate ---\n", oldMessage, newMessage);
            });

            this._client.on("debug", message =>{
                Logger.logDev("--- debug ---\n", message);
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
                session._musicPlayer.skipSong();
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
                session._musicPlayer.listSong(new Message(interaction));
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
                session._musicPlayer.randomSong(new Message(interaction));
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
                session._musicPlayer.rankSong(new Message(interaction));
            }
        }

        this._commandArr = [PlaySong, SkipSong, ListSong, RandomSong, RankSong];
    }

    async handleSlashCommand(client: DiscordJS.Client, interaction: DiscordJS.CommandInteraction): Promise<void>
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

        let newMessage = new Message(interaction);
        let session = this.getSession(newMessage);    
        slashCommand.run(session, interaction);
    };

    run()
    {
        this._client.login(DiscordToken);
    }
}