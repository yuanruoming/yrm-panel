// Minimal DOM harness: execute the actual BETA6 UI script without external packages.
// This checks that preset switching and required fields agree with the server contract.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
class HTMLElement {}
class HTMLFormElement extends HTMLElement {}
class FakeField extends HTMLElement {constructor(name,value=''){super();this.name=name;this.value=value;this.hidden=false;this.required=false;this.dataset={};}closest(){return this.parent||null}}
const fields=new Map();
for(const name of ['provider','name','hostname','recordType','httpMethod','urlTemplate','authType','headerName','username','token','bodyTemplate','responseMode','successCodes','unchangedCodes','errorCodes','detectionUrl','jsonProperty','jsonExpected'])fields.set(name,new FakeField(name));
const authLabels=['basic','header'].map(x=>{const node=new HTMLElement();node.dataset={ddnsAuth:x};node.hidden=false;node.input=fields.get(x==='basic'?'username':'headerName');node.querySelector=()=>node.input;return node});
const responseLabels=['codes','json'].map(x=>{const node=new HTMLElement();node.dataset={ddnsResponse:x};node.hidden=false;return node});
const techLabels=[new HTMLElement(),new HTMLElement()];techLabels.forEach(x=>x.hidden=false);
const tokenLabel=new HTMLElement();tokenLabel.hidden=false;fields.get('token').parent=tokenLabel;
const advanced=new HTMLElement();advanced.open=false;
const form=new HTMLFormElement();form.dataset={};form.elements={namedItem:n=>fields.get(n)||null};
form.querySelectorAll=s=>s==='[data-ddns-auth]'?authLabels:s==='[data-ddns-response]'?responseLabels:s==='[data-ddns-technical]'?techLabels:[];
form.querySelector=s=>s==='.yrm-ddns-advanced'?advanced:null;
const preset=new HTMLElement();preset.value='dynu4';
const desc=new HTMLElement();desc.textContent='';
const secretLabel=new HTMLElement();secretLabel.textContent='';
const map=new Map([['yrm-ddns-new-form',form],['yrm-ddns-provider-preset',preset],['yrm-ddns-provider-note',desc],['yrm-ddns-secret-label',secretLabel]]);
const listeners=new Map();
const document={getElementById:id=>map.get(id)||null,addEventListener:(event,callback)=>listeners.set(event,callback),body:{}};
class MutationObserver {observe(){}}
const sandbox={document,HTMLElement,HTMLFormElement,MutationObserver,window:{setInterval(){}}};
vm.runInNewContext(fs.readFileSync(path.join(root,'YrmPanel/wwwroot/js/v1-settings.js'),'utf8'),sandbox);
assert.equal(fields.get('provider').value,'dynu');
assert.equal(fields.get('authType').value,'basic');
assert.equal(authLabels[0].hidden,false,'Dynu username must be visible');
assert.equal(fields.get('username').required,true,'Dynu username must be required');
assert.equal(fields.get('urlTemplate').value.includes('dynu.com'),true);
assert.equal(secretLabel.textContent,'IP Update Password');
function change(value){preset.value=value;listeners.get('change')({target:Object.assign(preset,{closest:()=>form,id:'yrm-ddns-provider-preset'})})}
change('cloudflare4');
assert.equal(fields.get('provider').value,'cloudflare');
assert.equal(fields.get('recordType').value,'A');
assert.equal(fields.get('urlTemplate').value,'https://api.cloudflare.com/client/v4/zones');
assert.equal(secretLabel.textContent,'Cloudflare API Token');
assert.equal(authLabels[0].hidden,true);
assert.equal(techLabels[0].hidden,true);
change('cloudflare6');assert.equal(fields.get('recordType').value,'AAAA');
change('custom');assert.equal(fields.get('provider').value,'custom');assert.equal(techLabels[0].hidden,false);assert.equal(authLabels[1].hidden,false);
console.log('BETA6 DDNS form presets: Dynu IPv4, Cloudflare IPv4/IPv6, Custom — PASS');
