import Logger from './Logger';
import Sona from './Sona';

Logger.log(`Env: ${process.env.NODE_ENV}`);
if(process.env.NODE_ENV === 'production')
    Logger.log("Production");
else
    Logger.log("Development");

function main()
{
    const sona = new Sona();
    let lastUpdate : number = 0;
    let updateInterval : NodeJS.Timer | undefined = undefined;
    try
    {
        sona.run();
        
        lastUpdate = Date.now();
        updateInterval = setInterval(() => {
            let now = Date.now();
            let deltaTime = now - lastUpdate;
            sona.update(deltaTime);
        });
    }
    catch(err)
    {
        Logger.error(err);

        lastUpdate = Date.now();
        if(updateInterval != undefined)
            clearInterval(updateInterval!);

        return main();
    }
}

main();