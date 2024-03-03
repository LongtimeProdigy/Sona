## 중요! 소나 처음 설치 순서
1. ffmpeg 설치
2. Ubuntu- NodeJS, NPM 설치 (PPA 이용)
3. 모듈 설치 (npm install - package에 있는대로 설치 알아서해줌)
4. src/Token.json 생성 및 입력 (내용 요청 할 것)

## 개선(장기)- DiscordJS 라이브러리 제거?
- 솔직히 이건 안정적이니까 바꿀 필요는 없을듯
## 개선(장기)- ytdl, youtube-dl등 Youtube관련 라이브러리 제거?
- 문제가 있는데.. 유튜브 Resource를 해제하는데.. 암호화가 되어있고 복호화가 매번 주기적으로 바뀌는듯..
- 라이브러리에서 복호화 부분만 쓰도록하고, Stream은 직접 컨트롤 하는 방향은?
## SkyScanner
- Discord 일일 알림 연동? >> 매일 검색하면 quete 한도가 걱정됨... 원할때만 검색해야할듯
- 로그지우기
- limit 시간에서 Date로 변경하기
>> RapidAPI가 막혀서.. 다른 방법을 찾아야함

## 개선- RankSong, autoRandom에서 nextSong하는 부분.. next말고 playsong으론 안되나?

## 개선- Skip
- List 범위
## 개선- Rank
- 랭크 리소스에서 Element 제거 기능 (랜덤모드 하다가 Invalid하면 지워야하지 않을까? 비디오가 삭제되었거나 할 가능성...)
>> 아니면 주기적(setInterval)에서 invalid한 ID검출?
- 모든 영상이 다 들어가기때문에.. 관리자가 직접 지울 수도 있어야할듯
## 개선- Food
- 추가
- 수정
- 삭제
- 추천

## 버그- Sona 참여안된 상태에서 AutoRendom(/a)하면 터짐
- currentSongInfo가 없는데 접근하니 당연터짐
- NextSong : playcommand, randomsongcommand, autoRancomcommand, playsong(error/statechange 2개)
- PlaySong : nextsong, playsong(error)




## 스터디
- 초 단위 절삭 (어디에?)
- 달력 형태로 해당 날짜에 진행한 시간 표기 (누적? 최대?)
>> 달력에 공간이 색으로 차오른다
- 월요일 오전 6시를 마감시간으로
- 봇 알람 안가게 할 수 있는지?