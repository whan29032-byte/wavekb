// Runs before hydration. Keep this closure standalone: parity tests compare it with applyAppearance.
// Stored values are parsed as data and validated; none are interpolated as executable source.
export const APPEARANCE_BOOTSTRAP = `(function(){
  var v={};try{v=JSON.parse(localStorage.getItem('wavekb:appearance:v1')||'null')||{}}catch(e){}
  var t=['wave','sakura','aurora','star','ink','custom'].includes(v.theme)?v.theme:'wave';
  var m=['light','dark','system'].includes(v.mode)?v.mode:'system';
  var c=/^#[0-9a-f]{6}$/i.test(v.customColor||'')?v.customColor.toLowerCase():'#557fb8';
  function rgb(c){return [1,3,5].map(function(i){return parseInt(c.slice(i,i+2),16)})}
  function lum(c){return rgb(c).map(function(x){x=x/255;return x<=.04045?x/12.92:Math.pow((x+.055)/1.055,2.4)}).reduce(function(s,x,i){return s+x*[.2126,.7152,.0722][i]},0)}
  function ratio(a,b){a=lum(a);b=lum(b);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)}
  function mix(target,amount){return '#'+rgb(c).map(function(x){return Math.round(x+(target-x)*amount).toString(16).padStart(2,'0')}).join('')}
  function ink(c){return ratio(c,'#102033')>ratio(c,'#ffffff')?'#102033':'#f7fbff'}
  var light=c,dark=c;
  for(var s=1;ratio(light,'#f7fbff')<4.7&&s<=100;s++)light=mix(0,s/100);
  for(var s=1;ratio(dark,'#263342')<5&&s<=100;s++)dark=mix(255,s/100);
  var r=document.documentElement;r.dataset.wavekbTheme=t;r.dataset.wavekbMode=m;r.dataset.wavekbReduceMotion=String(v.reduceMotion===true);
  r.style.setProperty('--wavekb-user-accent',c);r.style.setProperty('--wavekb-user-accent-readable',light);r.style.setProperty('--wavekb-user-accent-dark',dark);r.style.setProperty('--wavekb-user-on-accent',ink(light));r.style.setProperty('--wavekb-user-on-accent-dark',ink(dark));
})();`;
