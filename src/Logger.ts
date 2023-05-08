export default class Logger
{
    static logDev(...args: any)
    {
        if(process.env.NODE_ENV !== 'production')
            console.log(args);
    }

    static log(...args: any)
    {
        console.log(args);
    }

    static error(...args: any)
    {
        console.error(args);
    }
}