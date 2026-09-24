const $=id=>document.getElementById(id);

const start=$("start"),game=$("game"),carsBox=$("cars"),modal=$("over");
const scoreEl=$("score"),bestEl=$("best"),levelEl=$("level"),clearedEl=$("cleared");
const soundBtn=$("sound"),toast=$("toast");

let best=Number(localStorage.getItem("trafficControlBest")||0);
let soundOn=localStorage.getItem("trafficControlSound")!=="off";
let audio=null,running=false,score=0,level=1,cleared=0,active="north";
let cars=[],last=0,spawnClock=0,raf=0,nextId=0;

bestEl.textContent=best;soundBtn.textContent=soundOn?"🔊":"🔇";

function audioInit(){
 if(!soundOn)return;
 try{audio ||= new(window.AudioContext||window.webkitAudioContext)();if(audio.state==="suspended")audio.resume()}catch{}
}
function beep(freq=500,d=.05,type="sine",vol=.025){
 if(!soundOn)return;
 try{
  audioInit();const o=audio.createOscillator(),g=audio.createGain();
  o.type=type;o.frequency.value=freq;g.gain.setValueAtTime(vol,audio.currentTime);
  g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+d);
  o.connect(g).connect(audio.destination);o.start();o.stop(audio.currentTime+d);
 }catch{}
}
function stats(){
 scoreEl.textContent=score;bestEl.textContent=best;levelEl.textContent=level;clearedEl.textContent=cleared;
}
function notify(text){
 toast.textContent=text;toast.classList.add("show");clearTimeout(notify.t);
 notify.t=setTimeout(()=>toast.classList.remove("show"),650);
}
function setLight(dir){
 active=dir;
 document.querySelectorAll(".light").forEach(x=>x.classList.toggle("active",x.classList.contains(dir[0])));
 document.querySelectorAll(".dir").forEach(x=>x.classList.toggle("active",x.dataset.dir===dir));
 beep(680,.045,"square",.02);
}
function speed(){return 40+level*5}
function spawnDelay(){return Math.max(420,1150-level*42)}

function spawn(){
 const dirs=["north","east","south","west"],dir=dirs[Math.floor(Math.random()*4)];
 const el=document.createElement("div");
 el.className="car"+(dir==="east"||dir==="west"?" hcar":"");
 const colors=["#4dfcff","#ff4fd8","#b7ff4a","#ffd45c","#9d8cff"];
 el.style.setProperty("--car",colors[Math.floor(Math.random()*colors.length)]);
 carsBox.appendChild(el);

 let x,y,vx=0,vy=0;
 if(dir==="north"){x=50;y=-5;vy=1}
 if(dir==="south"){x=50;y=105;vy=-1}
 if(dir==="east"){x=105;y=50;vx=-1}
 if(dir==="west"){x=-5;y=50;vx=1}

 const c={id:++nextId,el,dir,x,y,vx,vy};
 cars.push(c);place(c);
}
function place(c){c.el.style.left=c.x+"%";c.el.style.top=c.y+"%"}
function inCenter(c){return c.x>35&&c.x<65&&c.y>35&&c.y<65}
function atStop(c){
 if(c.dir==="north")return c.y>28&&c.y<36;
 if(c.dir==="south")return c.y<72&&c.y>64;
 if(c.dir==="east")return c.x<72&&c.x>64;
 return c.x>28&&c.x<36;
}
function out(c){
 if(c.dir==="north")return c.y>108;
 if(c.dir==="south")return c.y<-8;
 if(c.dir==="east")return c.x<-8;
 return c.x>108;
}
function move(c,dt){
 const green=c.dir===active;
 const v=speed()*dt/1000;
 if(atStop(c)&&!green){
   if(c.dir==="north")c.y+=c.vy*v*.12;
   else if(c.dir==="south")c.y+=c.vy*v*.12;
   else if(c.dir==="east")c.x+=c.vx*v*.12;
   else c.x+=c.vx*v*.12;
 }else{
   if(c.dir==="north"||c.dir==="south")c.y+=c.vy*v;
   else c.x+=c.vx*v;
 }
 place(c);
}
function collide(){
 for(let i=0;i<cars.length;i++){
  for(let j=i+1;j<cars.length;j++){
   const a=cars[i],b=cars[j];
   if(a.dir===b.dir||!inCenter(a)||!inCenter(b))continue;
   const dx=a.x-b.x,dy=a.y-b.y;
   if(Math.hypot(dx,dy)<7)return true;
  }
 }
 return false;
}
function cleanup(){
 cars=cars.filter(c=>{
  if(out(c)){
   c.el.remove();cleared++;score+=10+level*2;
   if(cleared%10===0){level++;notify("LEVEL "+level);beep(900,.08,"triangle",.03)}
   stats();return false;
  }
  return true;
 });
}
function loop(now){
 if(!running)return;
 const dt=Math.min(40,now-last||16);last=now;spawnClock+=dt;
 if(spawnClock>=spawnDelay()){spawnClock=0;spawn();if(level>=5&&Math.random()<.2)spawn()}
 cars.forEach(c=>move(c,dt));
 if(collide()){crash();return}
 cleanup();raf=requestAnimationFrame(loop);
}
function startGame(){
 audioInit();cancelAnimationFrame(raf);cars.forEach(c=>c.el.remove());cars=[];
 running=true;score=0;level=1;cleared=0;spawnClock=0;last=performance.now();
 modal.classList.remove("show");start.classList.add("hidden");game.classList.remove("hidden");
 setLight("north");stats();notify("CONTROL ACTIVE");spawn();spawn();beep(440,.08,"square",.03);
 raf=requestAnimationFrame(loop);
}
function crash(){
 if(!running)return;
 running=false;cancelAnimationFrame(raf);
 const newRecord=score>best;
 if(newRecord){best=score;localStorage.setItem("trafficControlBest",String(best))}
 $("fs").textContent=score;$("fb").textContent=best;$("fl").textContent=level;$("fc").textContent=cleared;
 $("newBest").textContent=newRecord?"★ NEW BEST SCORE ★":"";
 modal.classList.add("show");beep(95,.22,"sawtooth",.04);
}

document.querySelectorAll(".dir").forEach(b=>b.addEventListener("click",()=>{if(running)setLight(b.dataset.dir)}));
$("startBtn").addEventListener("click",startGame);
$("again").addEventListener("click",startGame);
soundBtn.addEventListener("click",()=>{
 soundOn=!soundOn;localStorage.setItem("trafficControlSound",soundOn?"on":"off");
 soundBtn.textContent=soundOn?"🔊":"🔇";if(soundOn)beep(650,.06);
});
document.addEventListener("keydown",e=>{
 if(!running&&(e.code==="Space"||e.code==="Enter")){e.preventDefault();startGame();return}
 if(!running)return;
 const m={Digit1:"north",Digit2:"east",Digit3:"south",Digit4:"west"};
 if(m[e.code]){e.preventDefault();setLight(m[e.code])}
 if(e.code==="Escape")crash();
});
window.addEventListener("blur",()=>{if(running)crash()});
stats();
