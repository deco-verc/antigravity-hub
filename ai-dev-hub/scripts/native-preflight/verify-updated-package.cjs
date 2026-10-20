'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const version=process.env.DECOHUB_PACKAGE_VERSION || JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error('INVALID_PACKAGE_VERSION');
const artifact=process.env.DECOHUB_PACKAGE_ARTIFACT||path.join(root,'dist-desktop-'+version),unpacked=path.join(artifact,'win-unpacked');
const asar=require(path.join(root,'node_modules','@electron','asar'));
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const pkg=JSON.parse(asar.extractFile(path.join(unpacked,'resources','app.asar'),'package.json').toString());
const failures=[],checked=[];
for(const name of fs.readdirSync(path.join(root,'server','dist')).filter(n=>n.endsWith('.js'))){
  const destination=path.join(unpacked,'resources','app.asar.unpacked','server','dist',name);
  if(!fs.existsSync(destination)||hash(fs.readFileSync(destination))!==hash(fs.readFileSync(path.join(root,'server','dist',name))))failures.push(name);
  checked.push(name);
}
const entries=asar.listPackage(path.join(unpacked,'resources','app.asar'));
const forbidden=entries.filter(n=>/^[/\\](?:scripts|server[/\\]test)(?:[/\\]|$)/.test(n)||/electron_sandbox_preload|fixture-child\.cjs|native-preflight/.test(n));
const setup=path.join(artifact,'DecoHUB Setup '+version+'.exe'),portable=path.join(artifact,'DecoHUB '+version+'.exe');
const output=process.env.DECOHUB_PACKAGE_EVIDENCE_DIR||'C:\\IA\\DecoHUB-native-sandbox-20261009\\logs';
fs.mkdirSync(output,{recursive:true});
// Extract the embedded application archive without launching the installer.
const bytes=fs.readFileSync(setup),magic=Buffer.from([0x37,0x7a,0xbc,0xaf,0x27,0x1c]);let index=-1,length=0;
for(let offset=0;offset<bytes.length;){const candidate=bytes.indexOf(magic,offset);if(candidate<0)break;offset=candidate+6;
  if(candidate+32>bytes.length)continue;
  const span=32n+bytes.readBigUInt64LE(candidate+12)+bytes.readBigUInt64LE(candidate+20);
  if(span>32n && span<BigInt(bytes.length-candidate)){index=candidate;length=Number(span);break;}}
if(index<0)throw new Error('INSTALLER_APPLICATION_ARCHIVE_NOT_FOUND');
const payload=path.join(output,'application-'+version+'.7z');fs.writeFileSync(payload,bytes.subarray(index,index+length));
const extracted=path.join(output,'installer-extract-'+version);fs.mkdirSync(extracted,{recursive:true});
const sevenZip=path.join(root,'node_modules','electron-winstaller','vendor','7z-x64.exe');
const listing=cp.execFileSync(sevenZip,['l','-slt',payload],{encoding:'utf8',windowsHide:true});
for(const match of listing.matchAll(/^Path = (.+)$/gm)){
  const name=match[1].trim();if(name===payload)continue;
  const absolute=path.resolve(extracted,name),relative=path.relative(extracted,absolute);
  if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('ARCHIVE_PATH_OUTSIDE_VERIFICATION_ROOT');
}
cp.execFileSync(sevenZip,['x','-y','-o'+extracted,payload],{stdio:'ignore',windowsHide:true});
const extractedAsar=path.join(extracted,'resources','app.asar');
if(hash(fs.readFileSync(extractedAsar))!==hash(fs.readFileSync(path.join(unpacked,'resources','app.asar'))))failures.push('installer/app.asar');
for(const name of checked){const rel=path.join('resources','app.asar.unpacked','server','dist',name);if(hash(fs.readFileSync(path.join(extracted,rel)))!==hash(fs.readFileSync(path.join(unpacked,rel))))failures.push('installer/'+name);}
const result={version:pkg.version,checkedServerFiles:checked.length,installerFilesCompared:checked.length+1,failures,productTestFixturesPackaged:forbidden,
  selectorPackaged:checked.includes('runtimeProfileSelector.js'),nativeBindingPackaged:checked.includes('nativeWorkspaceBinding.js'),
  setup:{path:setup,sha256:hash(bytes)},portable:{path:portable,sha256:hash(fs.readFileSync(portable))},installerExecuted:false,installed:false};
fs.writeFileSync(path.join(output,'packaging-integrity-'+version+'.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
if(failures.length||forbidden.length||pkg.version!==version)process.exitCode=1;
