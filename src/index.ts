import Logger from './Logger'

console.log(`Env: ${process.env.NODE_ENV}`);
if(process.env.NODE_ENV === 'production')
    Logger.log("Production");
else
    Logger.log("Development");

import Sona from './Sona';
const Application = new Sona();
Application.run();

let lastUpdate = Date.now();
const updateInterval = setInterval(() => {
    let now = Date.now();
    let deltaTime = now - lastUpdate;
    Application.update(deltaTime);
}, 500);