import fs from 'fs';
import path from "path"

import Logger from './Logger';

export class FileUtility
{
    static prepareFilePath(filePath: string)
    {
        if(fs.existsSync(filePath) == false)
        {
            fs.mkdirSync(path.dirname(filePath), {recursive: true});
            fs.writeFileSync(filePath, '{}');
        }
    }

    static readFileForJSON(filePath: string)
    {
        const data = fs.readFileSync(filePath, {encoding: 'utf-8'});
        return JSON.parse(data);
    }

    static writeFileForJSON(filePath: string, data: Object)
    {
        fs.writeFileSync(filePath, JSON.stringify(data), "utf8");
        Logger.logDev("Success FileWrite: ", filePath);
    }
}

export class TimeUtility
{
    static convertMillisecondToDigitalString(millisecond: number)
    {
        let secondTime = millisecond / 1000;
        let hours = Math.floor(secondTime / 3600);
        let minutes = Math.floor((secondTime - hours * 3600) / 60);
        let seconds = secondTime % 60;
    
        let ret = "";
        if(hours > 0)
            ret += "" + hours + ":" + (minutes < 10 ? "0" : "");
        ret += "" + minutes;
    
        return ret;
    }
}