import re,sys,glob
src=open('/home/claude/firemodels/fds/Source/read.f90').read()
nl={}
lines=src.split('\n')
for i,l in enumerate(lines):
    m=re.match(r'\s*NAMELIST\s*/(\w+)/(.*)',l)
    if not m: continue
    body=m.group(2); j=i
    while re.sub(r'!.*','',lines[j]).rstrip().endswith('&'):
        j+=1; body+=lines[j]
    body=re.sub(r'!.*','',body).replace('&','')
    nl.setdefault(m.group(1),set()).update(k.strip().upper() for k in body.split(',') if k.strip())
data=open('/home/claude/firemodels/fds/Source/data.f90').read()
quants=set(re.findall(r"%NAME\s*=\s*'([^']+)'",data))
bad=0
for fn in glob.glob(sys.argv[1]):
    txt=re.sub(r'!.*','',open(fn).read())
    for g,body in re.findall(r'&(\w+)(.*?)/',txt,re.S):
        if g=='TAIL': continue
        keys=re.findall(r'(\w+)\s*=',re.sub(r"'[^']*'","''",body))
        for k in keys:
            if k.upper() not in nl.get(g,set()):
                print(fn,g,'CLE INCONNUE',k); bad+=1
        for q in re.findall(r"QUANTITY='([^']+)'",body):
            if q not in quants and not re.match(r'(VOLUME|MASS|HEAT) FLOW',q):
                print(fn,'GRANDEUR INCONNUE',q); bad+=1
print('namelists:',sorted(nl)[:5],'... erreurs:',bad)
