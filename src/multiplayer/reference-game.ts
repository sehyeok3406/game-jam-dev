/** A deterministic, tiny co-op fixture and the generation contract's working example. */
export const COOP_REFERENCE_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>함께 모으기</title></head><body style="margin:0;background:#101522;color:white;font-family:system-ui"><p id="score">화살표/WASD로 이동해 노란 보석 3개를 함께 모으세요.</p><canvas width="640" height="400"></canvas>
<script type="application/json" id="gamejam-multiplayer">{"version":1,"authority":"host","minPlayers":2,"maxPlayers":2,"sdkVersion":1,"solo":true,"stateVersion":1}</script>
<script>
if (!window.GameJamMultiplayer) { document.querySelector('#score').textContent='Game Jam! 앱에서 혼자 연습하거나 함께 플레이하세요.'; }
else {
const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');
const held=new Set();
function input(){GameJamMultiplayer.sendInput({x:Number(held.has('ArrowRight')||held.has('d'))-Number(held.has('ArrowLeft')||held.has('a')),y:Number(held.has('ArrowDown')||held.has('s'))-Number(held.has('ArrowUp')||held.has('w'))});}
addEventListener('keydown',e=>{held.add(e.key);if(e.key.startsWith('Arrow'))e.preventDefault();input();});
addEventListener('keyup',e=>{held.delete(e.key);input();});addEventListener('blur',()=>{held.clear();input();});
GameJamMultiplayer.register({
createState({players}){return {players:players.map((p,i)=>({id:p.id,x:40,y:80+i*50})),items:[{id:1,x:120,y:80},{id:2,x:260,y:160},{id:3,x:420,y:240}],score:0};},
validateInput(i){return !!i&&typeof i==='object'&&(!('x'in i)||[-1,0,1].includes(i.x))&&(!('y'in i)||[-1,0,1].includes(i.y));},
step(state,{inputs,dt}){for(const command of inputs){const p=state.players.find(p=>p.id===command.playerId);if(!p)continue;p.x=Math.max(12,Math.min(628,p.x+(command.input.x||0)*160*dt));p.y=Math.max(12,Math.min(388,p.y+(command.input.y||0)*160*dt));for(const item of [...state.items])if(Math.hypot(p.x-item.x,p.y-item.y)<22){state.items=state.items.filter(i=>i.id!==item.id);state.score++;}}},
render(state,{selfId,solo}){ctx.clearRect(0,0,640,400);state.items.forEach(i=>{ctx.fillStyle='#ffdc55';ctx.fillRect(i.x-7,i.y-7,14,14);});state.players.forEach(p=>{ctx.fillStyle=p.id===selfId?'#66ddcc':'#aa99ff';ctx.beginPath();ctx.arc(p.x,p.y,12,0,7);ctx.fill();});document.querySelector('#score').textContent=(solo?'혼자 연습':'함께 플레이')+' · 보석 '+state.score+'/3'+(state.items.length?' · 화살표/WASD로 이동':' · 성공!');},
getOutcome(state){return state.items.length?null:{result:'win'};}
});
}
</script></body></html>`;
