// OpenAI 공식 Node.js 모듈 배포
// https://platform.openai.com/docs/api-reference/introduction
// https://stackoverflow.com/questions/75624308/openai-gpt-3-api-errors-text-does-not-exist-ts2339-prompt-does-not-exis

import Logger from './Logger';
import { Configuration, OpenAIApi } from 'openai';
import {ChatGPTToken, ChatGPTOrganizationID} from './Token.json';

export class ChatGPT
{
    _openAI: OpenAIApi;
    _token: number;
    constructor()
    {
        const configuration = new Configuration({
                organization: ChatGPTOrganizationID, 
                apiKey: ChatGPTToken
            });
        this._openAI = new OpenAIApi(configuration);
        this._token = 0;    // resource에서 읽어와야함
    }

    async send(sentence: string)
    {
        const res = await this._openAI.createChatCompletion({
                model: "gpt-3.5-turbo", 
                messages: [{"role": "user", "content": sentence}]
            }, undefined);
        this._token += res.data.usage!.total_tokens;
        Logger.logDev("Token: ", this._token);

        return res.data.choices[0].message!.content;
    }
}