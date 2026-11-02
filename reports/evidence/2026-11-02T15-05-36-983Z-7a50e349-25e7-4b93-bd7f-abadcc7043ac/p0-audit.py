
import collections,csv,hashlib,json,pathlib,statistics,sys
VARIANTS=['baseline','context','optimizer','full']
def inspect(root):
    root=pathlib.Path(root)
    manifest=json.loads((root/'manifest.json').read_text())
    summary=json.loads((root/'summary.json').read_text())
    assert manifest['provider']=='http' and len(manifest['schedule'])==144
    rows=[]; fingerprints=collections.Counter(); models=collections.Counter(); profiles=collections.Counter()
    for entry in manifest['schedule']:
        name=f"{entry['taskId']}-{entry['variant']}-{entry['repeat']}"
        base=root/'attempts'/name
        result=json.loads((base/'result.json').read_text())
        events=[json.loads(line) for line in (base/'journal.jsonl').read_text().splitlines()]
        byseq={e['seq']:e for e in events}
        profiles[str(events[0]['data'].get('promptVersion','legacy'))]+=1
        counters=collections.Counter()
        errors=collections.Counter(); kinds=collections.Counter(); finishes=collections.Counter()
        last_write=0; dispatched=[]; previous_reads={}
        for e in events:
            d=e['data']
            if e['type']=='response' and d['dispatched']:
                kinds[d['kind']]+=1
                counters['input_known']+=d['usage']['inputTokens'] or 0
                counters['output_known']+=d['usage']['outputTokens'] or 0
                counters['usage_complete']+=d['usage']['inputTokens'] is not None and d['usage']['outputTokens'] is not None
                r=d['response']
                if r:
                    if r['fingerprint'] is not None: fingerprints[r['fingerprint']]+=1
                    if r['actualModel'] is not None: models[r['actualModel']]+=1
                    finishes[r['finish']]+=1
                    if r['finish']=='length': counters['length_'+d['kind']]+=1
                if d['error']: counters['response_error_'+d['error']]+=1
            if e['type']=='context_compacted':
                counters['compactions']+=1
                counters['summary_with_DSML']+='DSML' in d['summary']
            if e['type']=='tool_end' and d['dispatched']:
                call=byseq[d['startSeq']]['data']['call']
                name_=call['name']; value=d['result']
                counters['tool_calls']+=1
                counters['tool_'+name_]+=1
                if d['error'] or value and not value['ok']:
                    counters['tool_errors']+=1
                if value and not value['ok']:
                    errors[value['errorCode']]+=1
                if value and value['ok'] and name_ in ['write_file','edit_file','delete_file']:
                    last_write=e['seq']
                dispatched.append((e['seq'],name_))
                if value and value['ok'] and name_=='read_file':
                    args=json.loads(call['arguments'])
                    path=args['path']; digest=hashlib.sha256(value['output'].encode()).hexdigest()
                    if previous_reads.get(path)==digest: counters['same_visible_read_again']+=1
                    previous_reads[path]=digest
        counters['reads_after_final_write']=sum(seq>last_write and name_=='read_file' for seq,name_ in dispatched) if last_write else 0
        counters['tools_after_final_write']=sum(seq>last_write for seq,name_ in dispatched) if last_write else 0
        functional=result['integrity']['passed'] and result['publicTest']['passed'] and result['acceptanceTest']['passed']
        agent=result['agent']
        assert sum(kinds.values())==agent['modelRequests']
        assert counters['tool_calls']==agent['toolCalls'] and counters['tool_errors']==agent['toolErrors']
        assert counters['input_known']==agent['knownInputTokens'] and counters['output_known']==agent['knownOutputTokens']
        assert counters['compactions']==agent['compactions']
        rows.append(dict(taskId=result['taskId'],suite=result['suite'],variant=result['variant'],repeat=result['repeat'],
            passed=result['passed'],functional=bool(functional),functionalFailedOnTermination=bool(functional and not result['passed']),
            termination=agent['termination'],failureReason=result['failureReason'],durationMs=agent['durationMs'],
            counters=dict(counters),toolErrors=dict(errors),requestKinds=dict(kinds),finishes=dict(finishes)))
    groups={}
    for variant in VARIANTS:
        groups[variant]={}
        for suite in ['S','H','overall']:
            selected=[r for r in rows if r['variant']==variant and (suite=='overall' or r['suite']==suite)]
            count=len(selected); passed=sum(r['passed'] for r in selected)
            sums=collections.Counter(); errors=collections.Counter(); kinds=collections.Counter(); finishes=collections.Counter()
            for r in selected:
                sums.update(r['counters']); errors.update(r['toolErrors']); kinds.update(r['requestKinds']); finishes.update(r['finishes'])
            actual=summary['byVariant'][variant][suite]
            assert actual['success']['count']==count and actual['success']['passed']==passed
            assert actual['requests']['total']==sum(kinds.values())
            assert actual['tools']['calls']==sums['tool_calls'] and actual['tools']['errors']==sums['tool_errors']
            assert actual['tokens']['input']['known']==sums['input_known'] and actual['tokens']['output']['known']==sums['output_known']
            assert actual['compactions']==sums['compactions']
            groups[variant][suite]=dict(count=count,passed=passed,rate=passed/count,
                functional=sum(r['functional'] for r in selected),
                functionalFailedOnTermination=sum(r['functionalFailedOnTermination'] for r in selected),
                failures=dict(collections.Counter(r['failureReason'] for r in selected if not r['passed'])),
                terminations=dict(collections.Counter(r['termination'] for r in selected)),
                counters=dict(sums),toolErrors=dict(errors),requestKinds=dict(kinds),finishes=dict(finishes),
                meanDurationMs=statistics.mean(r['durationMs'] for r in selected))
    return dict(runId=manifest['runId'],implementationCommit=manifest['implementationCommit'],dirty=manifest['dirty'],
        benchmarkCommit=manifest['benchmarkCommit'],benchmarkHash=manifest['benchmarkHash'],model=manifest['config']['model'],
        actualModels=dict(models),fingerprints=dict(fingerprints),promptVersions=dict(profiles),groups=groups,attempts=rows)
if __name__=='__main__':
    new=inspect(sys.argv[1]);old=inspect(sys.argv[2])
    assert new['benchmarkCommit']==old['benchmarkCommit'] and new['benchmarkHash']==old['benchmarkHash']
    output=dict(new=new,old=old,comparisons={})
    for variant in VARIANTS:
        n=new['groups'][variant]['overall']; o=old['groups'][variant]['overall']
        output['comparisons'][variant]=dict(successDeltaPP=(n['rate']-o['rate'])*100,
            permissionDeniedBefore=o['toolErrors'].get('permission_denied',0),permissionDeniedAfter=n['toolErrors'].get('permission_denied',0),
            lengthBefore=o['finishes'].get('length',0),lengthAfter=n['finishes'].get('length',0),
            functionalFailedOnTerminationBefore=o['functionalFailedOnTermination'],functionalFailedOnTerminationAfter=n['functionalFailedOnTermination'],
            tokensBefore=o['counters']['input_known']+o['counters']['output_known'],tokensAfter=n['counters']['input_known']+n['counters']['output_known'],
            requestsBefore=sum(o['requestKinds'].values()),requestsAfter=sum(n['requestKinds'].values()))
    target=pathlib.Path(sys.argv[3]);target.write_text(json.dumps(output,ensure_ascii=False,indent=2)+chr(10))
    print(json.dumps(dict(runId=new['runId'],actualModels=new['actualModels'],fingerprints=new['fingerprints'],
        promptVersions=new['promptVersions'],comparisons=output['comparisons']),ensure_ascii=False,indent=2))
