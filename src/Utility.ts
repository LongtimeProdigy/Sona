import fs from 'fs';
import path from "path"

import Logger from './Logger';

export class FileHelper
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