({MAKEFUN_INPUT_DIR:I="/input",MAKEFUN_OUTPUT_DIR:O="/output"}=process.env)
F=require("fs")
for(id of F.readdirSync(I)){
S=F.readFileSync(I+"/"+id+"/level.txt");w=S.indexOf("\n")+1
FA=[...S].map(x=>x!=35);B=[];GL=0n;BX=0n;P=0;lq=[];b=1n
for(i=0;i<S.length;i++){B[i]=b;b+=b;x=S[i];if(x==36|x==42)BX|=B[i];if(x==46|x==42|x==43){GL|=B[i];lq.push(i)}if(x==64|x==43)P=i}
D=[-w,w,-1,1];C="udlr";LM=GL
for(c of lq)for(d of D){b=c-d;s=b-d;if(FA[b]&&FA[s]&&!(LM&B[b])){LM|=B[b];lq.push(b)}}
NA=FA.slice();NA.fill(0,P-P%w,P-P%w+w)
fl=(s,b,R)=>{p={[s]:s};vs=[s];fm=s;for(x of vs)for(e of D){g=x+e;if(R[g]&&!(b&B[g])&&!p[g]){p[g]=x;vs.push(g);if(g<fm)fm=g}};return p}
pa=(p,t)=>p[t]==t?"":pa(p,p[t])+C[D.indexOf(t-p[t])]
ans="";cur=P
for(i=0;i<S.length;i++)if(NA[i]&&BX&B[i]){
fl(i,0n,NA);cells=vs;cm=0n;for(c of cells)NA[c]=0,cm|=B[c]
gm=GL&cm;sm=BX&cm
nd={};fl(cur,BX,FA);q=[sm+"/"+fm];nd[q[0]]=[sm,cur,""]
for(kk of q){[m,p,st]=nd[kk];if(!(m&~gm))break;K=BX^sm|m;f=fl(p,K,FA)
for(c of cells)if(m&B[c])for(j=4;j--;){d=D[j];a=c-d;t=c+d;if(f[a]&&LM&B[t]&&!(K&B[t])){nm=m^B[c]|B[t];fl(c,K^B[c]|B[t],FA);nk=nm+"/"+fm;nd[nk]||(nd[nk]=[nm,c,st+pa(f,a)+C[j]],q.push(nk))}}}
y=nd[kk];ans+=y[2];cur=y[1];BX=BX^sm|y[0]}
F.mkdirSync(z=O+"/"+id,{recursive:!0});F.writeFileSync(z+"/solution.txt",ans)}