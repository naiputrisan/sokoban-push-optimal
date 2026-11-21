({MAKEFUN_INPUT_DIR:I="/input",MAKEFUN_OUTPUT_DIR:O="/output"}=process.env)
F=require("fs")
for(k=1;k<6;k++){
S=F.readFileSync(I+"/i00"+k+"/level.txt");w=S.indexOf(10)+1;D=[-w,w,-1,1];C="udlr"
Q=[];B=[];P=0;L=[]
S.forEach((c,i)=>{if(c==46|c==42|c==43)Q.push(i),L[i]=1;if(c==36|c==42)B.push(i);if(c==64|c==43)P=i})
gs=L.slice();q=Q
for(x of q)for(d of D){y=x-d;if(S[y]!=35&&S[y-d]!=35&&!L[y])L[y]=1,q.push(y)}
fl=(s,bl)=>{p={[s]:" "};MM=[];for(u of bl)MM[u]=1;(r=x=>{for(d of D){y=x+d;if(S[y]!=35&&!MM[y]&&!p[y]){p[y]=p[x]+C[D.indexOf(d)];r(y)}}})(s);return p}
Z=[];for(i=P-P%w;i<P-P%w+w;i++)Z.push(i)
A="";e=P
for(b0 of B){
f=fl(b0,Z);rb=[];OB=[];for(b of B)(f[b]?rb:OB).push(b)
q=[[rb,e,""]];V={[rb+"/"+e]:1}
for([bs,pp,ms] of q){
if(bs.every(b=>gs[b])){A+=ms;e=pp;B=OB.concat(bs);break}
f=fl(pp,bs.concat(OB));st=MM
for(b of bs)for(j=4;j--;){d=D[j];a=b-d;t=b+d
if(f[a]&&!st[t]&&L[t]){nb=bs.map(u=>u==b?t:u);nb.sort((x,y)=>x-y)
if(!V[h=nb+"/"+b]){V[h]=1;q.push([nb,b,ms+f[a]+C[j]])}}}}}
F.mkdirSync(z=O+"/i00"+k,{recursive:!0});F.writeFileSync(z+"/solution.txt",A)}
