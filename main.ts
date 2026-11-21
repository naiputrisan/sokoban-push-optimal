({MAKEFUN_INPUT_DIR:I="/input",MAKEFUN_OUTPUT_DIR:O="/output"}=process.env)
F=require("fs");U=Uint8Array
for(id of F.readdirSync(I)){
T=F.readFileSync(I+"/"+id+"/level.txt","utf8");w=T.indexOf("\n");S=T.split("\n").join("");N=S.length
A=new U(N);FA=new U(N);BI=[];P=0;GM=0n
for(i=0;i<N;i++){A[i]=[1,2,4,6,8,10]["#.$*@+".indexOf(S[i])];if(A[i]&8)P=i;BI[i]=1n<<BigInt(i);if(A[i]&1)continue;FA[i]=1;if(A[i]&4)GM|=BI[i]}
D=[-w,w,-1,1];C="udlr";hy=P/w|0;NA=FA.slice();NA.fill(0,hy*w,hy*w+w);ans="";cur=P
fl=(s,bk,rg)=>{p={[s]:s};fm=s;vs=[s];V=c=>{if(c<fm)fm=c;for(e of D){g=c+e;if(rg[g]&&!(bk&BI[g])&&!p[g]){p[g]=c;vs.push(g);V(g)}}};V(s);return p}
pa=(p,t)=>p[t]==t?"":pa(p,p[t])+C[D.indexOf(t-p[t])]
for(i=0;i<N;i++)if(NA[i]){
fl(i,0n,NA);cells=vs.slice();gm=0n;sm=0n;LV=new U(N);lq=[]
for(c of cells){NA[c]=0;if(A[c]&2){gm|=BI[c];LV[c]=1;lq.push(c)}if(A[c]&4)sm|=BI[c]}
if(!sm)continue
for(c of lq)for(d of D){b=c-d;s=c-2*d;if(FA[b]&&FA[s]&&!LV[b]){LV[b]=1;lq.push(b)}}
OM=GM^sm;nd={};fl(cur,GM,FA);q=[k0=sm+"/"+fm];nd[k0]=[sm,cur,"",""]
for(kk of q){[m,p]=nd[kk]
if(!(m&~gm))break
K=OM|m;f=fl(p,K,FA)
for(c of cells)if(K&BI[c])for(d of D){st=c-d;tg=c+d
if(!f[st]||!LV[tg]||K&BI[tg])continue
nm=m^BI[c]|BI[tg];fl(c,OM|nm,FA);nk=nm+"/"+fm
if(!nd[nk]){nd[nk]=[nm,c,kk,pa(f,st)+C[D.indexOf(d)]];q.push(nk)}}}
ch="";for(x=nd[kk];x;x=nd[x[2]])ch=x[3]+ch
ans+=ch;cur=nd[kk][1];GM=OM|nd[kk][0]}
z=O+"/"+id;F.mkdirSync(z,{recursive:!0});F.writeFileSync(z+"/solution.txt",ans)}
