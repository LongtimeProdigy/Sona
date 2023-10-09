export default class Logger
{
    static log(...args: any)
    {
        let sentence: string = "";

        let now = new Date();
        sentence += `[${now}]`;

        for(const arg of args)
            sentence += arg;

        console.log(sentence);
    }

    static error(...args: any)
    {
        let sentence: string = "";

        let now = new Date();
        sentence += `[${now}]`;
        
        for(const arg of args)
            sentence += arg;

        //console.error(sentence);
        console.trace(sentence);
    }

    static trace(...args: any)
    {
        let sentence: string = "";

        let now = new Date();
        sentence += `[${now}]`;
        
        for(const arg of args)
            sentence += arg;

        console.trace(sentence);
    }

    static logDev(...args: any)
    {
        if(process.env.NODE_ENV !== 'production')
            Logger.log(args);
    }
}