import Logger from './Logger'

if(process.env.NODE_ENV === 'production')
    Logger.log("Production");
else
    Logger.log("Development");

import Sona from './Sona';
const Application = new Sona();
Application.run();