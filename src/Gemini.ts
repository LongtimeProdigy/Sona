import { ChildProcess, spawn } from 'child_process';

export class Gemini
{
    _gemini: ChildProcess;
    private fullResponse: string = '';
    private onResponseCallback: any;
    // Gemini CLI가 다음 입력을 기다릴 때 출력하는 프롬프트 문자열
    // 실제 CLI의 프롬프트에 맞게 수정해야 할 수 있습니다.
    private readonly PROMPT = '> ';
    
    constructor()
    {
        // stdio를 명시하지 않거나 'pipe'로 설정하여 스트림을 제어합니다.
        this._gemini = spawn('gemini', [], {
            shell: process.platform === 'win32',
        });
        // stdout 스트림에서 데이터를 수신합니다.
        this._gemini.stdout!.on('data', (data: Buffer) => {
            this._handleData(data);
        });
        // stderr 스트림에서 에러 데이터를 수신합니다.
        this._gemini.stderr!.on('data', (data: Buffer) => {
            console.error(`[GEMINI STDERR]: ${data.toString()}`);
        });
        // 프로세스 종료 이벤트를 처리합니다.
        this._gemini.on('close', (code: number | null) => {
            console.log(`[SYSTEM] Gemini CLI 프로세스가 종료되었습니다. 종료 코드: ${code}`);
        });
    }

    /**
     * stdout에서 들어온 데이터를 처리하는 내부 메소드
     */
    private _handleData(data: Buffer): void {
        const output = data.toString();
        // 디버깅을 위해 모든 출력을 로깅합니다.
        // console.log(`[DEBUG STDOUT]:`, output);

        // 현재 응답 버퍼에 추가합니다.
        this.fullResponse += output;

        // 출력에 프롬프트가 포함되어 있다면, 응답이 끝난 것으로 간주합니다.
        if (this.fullResponse.trim().endsWith(this.PROMPT)) 
        {
            // 콜백이 등록되어 있다면 실행합니다.
            if (this.onResponseCallback) 
            {
                // 프롬프트 문자열을 제외한 순수 응답만 추출합니다.
                const cleanResponse = this.fullResponse.replace(this.PROMPT, '').trim();

                // 콜백을 실행하고 초기화합니다.
                this.onResponseCallback(cleanResponse);
                this.onResponseCallback = null;
            }
            // 다음 응답을 위해 버퍼를 초기화합니다.
            this.fullResponse = '';
        }
    }

    public send(sentence: string): string
    {
        this._gemini.stdin!.write(`${sentence}\n`);
        return "Sona is thinking......";
    }

    /**
    * 'exit' 명령어를 보내 Gemini CLI를 안전하게 종료합니다.
    */
    public close(): void {
        console.log('Sona AI 종료 중...');
        this._gemini.stdin!.write('exit\n');
    }
}