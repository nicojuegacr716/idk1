import pathlib 
lines = pathlib.Path('GetsCoin.tsx').read_text(encoding='utf-8').splitlines() 
for idx,line in enumerate(lines, start=1): 
    if 250 <= idx <= 330: 
        print(f\"{idx}: {line}\") 
