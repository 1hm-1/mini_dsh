
import hashlib,json,pathlib,sys
run=pathlib.Path(sys.argv[1]).resolve()
evidence=pathlib.Path(sys.argv[2]).resolve()
report=pathlib.Path(sys.argv[3]).resolve()
control=pathlib.Path(sys.argv[4]).resolve()
def digest(p):
    b=p.read_bytes()
    return dict(path=str(p),bytes=len(b),sha256=hashlib.sha256(b).hexdigest())
def save(p,data):
    p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+chr(10))
manifest=json.loads((run/'manifest.json').read_text())
selections={}
for entry in manifest['schedule']:
    stem=entry['taskId']+'-'+entry['variant']+'-'+str(entry['repeat'])
    result=json.loads((run/'attempts'/stem/'result.json').read_text())
    if not result['passed'] and not any('earliest-failure:'+result['failureReason'] in r for r in selections.values()):
        selections.setdefault(stem,[]).append('earliest-failure:'+result['failureReason'])
    if result['agent']['compactions'] and not any('first-actual-compaction' in r for r in selections.values()):
        selections.setdefault(stem,[]).append('first-actual-compaction')
    assert result['integrity']['passed']
trace_dir=evidence/'traces'
trace_dir.mkdir(exist_ok=True)
records=[]
for stem,reasons in selections.items():
    journal=run/'attempts'/stem/'journal.jsonl'
    events=[json.loads(l) for l in journal.read_text().splitlines()]
    byseq={e['seq']:e for e in events}
    seqs={1,events[-1]['seq']}
    worker=[e for e in events if e['type']=='response' and e['data']['kind']=='worker']
    if worker: seqs.add(worker[-1]['seq'])
    writes=[]
    for e in events:
        d=e['data']
        if e['type']=='context_compacted': seqs.add(e['seq'])
        if e['type']=='response' and (d['error'] is not None or d['kind']!='worker'):
            seqs.update([e['seq'],d['requestSeq']])
        if e['type']=='tool_end':
            start=byseq[d['startSeq']]
            if d['error'] or d['result'] and not d['result']['ok']:
                seqs.update([e['seq'],d['startSeq']])
            if d['result'] and d['result']['ok'] and start['data']['call']['name'] in ['write_file','edit_file','delete_file']:
                writes.append((d['startSeq'],e['seq']))
    if writes: seqs.update(writes[0]+writes[-1])
    row=dict(stem=stem,reasons=reasons,sourceJournal=str(journal.relative_to(run)),
        sourceJournalSha256=hashlib.sha256(journal.read_bytes()).hexdigest(),
        note='Selected original events retain their seq and content. This is an excerpt, not a complete replay.',
        events=[e for e in events if e['seq'] in seqs])
    save(trace_dir/(stem+'.json'),row)
    records.append(dict(stem=stem,reasons=reasons,path=stem+'.json',eventCount=len(row['events']),
        sourceJournal=row['sourceJournal'],sourceJournalSha256=row['sourceJournalSha256']))
save(trace_dir/'selection.json',dict(rule='Earliest schedule order per strict failureReason, plus the first actual compaction. No best-repeat selection.',traces=records))
def files(root):
    return sorted(p for p in root.rglob('*') if p.is_file())
def rows(root,items):
    return [dict(path=str(p.relative_to(root)),bytes=(d:=digest(p))['bytes'],sha256=d['sha256']) for p in items]
raw=files(run)
derived=[p for p in files(evidence) if p.name!='hash-index.json']
ctrl=files(control)
save(evidence/'hash-index.json',dict(schemaVersion=1,runId=manifest['runId'],sourceRunRoot=str(run),
    rawRunFileCount=len(raw),rawRunFiles=rows(run,raw),evidenceRoot=str(evidence),evidenceFileCount=len(derived),
    evidenceFiles=rows(evidence,derived),report=digest(report),controlRoot=str(control),
    controlFileCount=len(ctrl),controlFiles=rows(control,ctrl),note='The index excludes itself. Raw and control files are preserved, not rewritten.'))
print(json.dumps(dict(rawFiles=len(raw),evidenceFiles=len(derived),controlFiles=len(ctrl),traces=len(records),
    events=sum(t['eventCount'] for t in records))))
