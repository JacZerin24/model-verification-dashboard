import { useEffect, useMemo, useState } from 'react'
import {
  Activity, ArrowRight, BarChart3, Check, ChevronDown, CircleAlert, Clock3,
  Download, ExternalLink, Gauge, HelpCircle, Info, Layers3, MapPin,
  Menu, RefreshCw, ShieldCheck, SlidersHorizontal, Target, Thermometer,
  TrendingDown, Wind, X,
} from 'lucide-react'
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip,
  XAxis, YAxis,
} from 'recharts'
import './styles.css'

type Station = { id: string; name: string }
type Model = { id: string; label: string; family?: string }
type Element = { id: string; label: string; unit: string }
type FairScore = {
  station: string; model: string; element: string; days: number; lead: string;
  n: number; mae: number; rmse: number; bias: number; winRate: number
}
type DailyScore = {
  station: string; model: string; element: string; lead: string;
  day: string; n: number; mae: number
}
type Dashboard = {
  generatedAt: string | null
  dataStatus: string
  stations: Station[]
  models: Model[]
  elements: Element[]
  fairScores?: FairScore[]
  dailyScores?: DailyScore[]
  comparisonProducts?: Record<string, Record<string, string[]>>
  quality?: {
    forecastRecords?: number; observationRecords?: number
    matchedElementPairs30d?: number; fairCaseKeys30d?: number
    warnings?: string[]; NBMPercentilesAvailable?: boolean
  }
}
type Tab = 'rankings' | 'stations' | 'percentiles' | 'about'
type Lead = '0-12' | '12-24' | '24-48' | '48-72' | '72-120' | '120+'
const LEAD_OPTIONS: {value: Lead; label: string; short: string}[] = [
  {value: '0-12', label: '0–12 hours', short: '0–12h'},
  {value: '12-24', label: '12–24 hours', short: '12–24h'},
  {value: '24-48', label: '24–48 hours', short: '24–48h'},
  {value: '48-72', label: '48–72 hours', short: '48–72h'},
  {value: '72-120', label: 'About 72 hours', short: '72h'},
]
const COLOR: Record<string, string> = { NBS: '#168d87', NBE: '#4b70c5', GFS: '#d38b3e', NAM: '#8c66ad' }
const FRIENDLY: Record<string, string> = {
  NBS: 'NBM Short', NBE: 'NBM Extended', GFS: 'GFS MOS', NAM: 'NAM MOS',
}
const FILLER: Dashboard = {
  generatedAt:null, dataStatus:'awaiting_data',
  stations:[
    {id:'KBTR',name:'Baton Rouge'}, {id:'KMSY',name:'New Orleans Intl'},
    {id:'KHDC',name:'Hammond'}, {id:'KNEW',name:'New Orleans Lakefront'},
    {id:'KASD',name:'Slidell'}, {id:'KMCB',name:'McComb'}, {id:'KGPT',name:'Gulfport'},
  ],
  models:[
    {id:'NBS',label:'NBM Short'}, {id:'NBE',label:'NBM Extended'},
    {id:'GFS',label:'GFS MOS'}, {id:'NAM',label:'NAM MOS'},
  ],
  elements:[
    {id:'tmp',label:'Temperature',unit:'°F'},{id:'dpt',label:'Dew point',unit:'°F'},
    {id:'wsp',label:'Wind speed',unit:'kt'},{id:'gst',label:'Wind gust',unit:'kt'},
  ],
  fairScores:[], dailyScores:[],
  comparisonProducts: {
    tmp: {'0-12':['NBS','GFS','NAM'],'12-24':['NBS','GFS','NAM'],'24-48':['NBS','NBE','GFS','NAM'],'48-72':['NBS','NBE','GFS','NAM'],'72-120':['NBS','NBE','GFS','NAM']},
    dpt: {'0-12':['NBS','GFS','NAM'],'12-24':['NBS','GFS','NAM'],'24-48':['NBS','NBE','GFS','NAM'],'48-72':['NBS','NBE','GFS','NAM'],'72-120':['NBS','NBE','GFS','NAM']},
    wsp: {'0-12':['NBS','GFS','NAM'],'12-24':['NBS','GFS','NAM'],'24-48':['NBS','NBE','GFS','NAM'],'48-72':['NBS','NBE','GFS','NAM'],'72-120':['NBS','NBE','GFS','NAM']},
    gst: {'24-48':['NBS','NBE'],'48-72':['NBS','NBE'],'72-120':['NBS','NBE']},
  },
}

function formatUpdated(value: string|null) {
  if (!value) return 'Not updated yet'
  return new Intl.DateTimeFormat('en-US', {
    month:'short',day:'numeric',hour:'numeric',minute:'2-digit',
    timeZone:'America/Chicago',timeZoneName:'short',
  }).format(new Date(value))
}
function metric(value: number | undefined, digits = 2) {
  return value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits)
}
function signed(value: number | undefined) {
  return value === undefined ? '—' : (value > 0 ? '+' : '') + value.toFixed(2)
}
function friendly(model: string) { return FRIENDLY[model] || model }
function compare(a: FairScore, b: FairScore) { return a.mae - b.mae || a.model.localeCompare(b.model) }
function confidence(n: number) {
  return n >= 30 ? 'Established sample' : n >= 10 ? 'Small sample' : 'Very small sample'
}
function safeDownload(content:string, filename:string) {
  const file = new Blob([content],{type:'text/csv;charset=utf-8'})
  const url=URL.createObjectURL(file)
  const link=document.createElement('a')
  link.href=url
  link.download=filename
  link.click()
  setTimeout(()=>URL.revokeObjectURL(url),1000)
}
function SelectField({id,label,value,options,onChange,icon:Icon}:{id:string;label:string;value:string;options:{value:string;label:string}[];onChange:(s:string)=>void;icon:typeof MapPin}) {
  return <div className="filter-field">
    <label htmlFor={id}>{label}</label>
    <div className="select-shell">
      <Icon size={16} aria-hidden="true"/>
      <select id={id} value={value} onChange={e=>onChange(e.target.value)}>
        {options.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}
      </select>
      <ChevronDown size={15} aria-hidden="true"/>
    </div>
  </div>
}
function Placeholder({title,body}:{title:string;body:string}) {
  return <div className="placeholder"><div className="placeholder-icon"><Clock3 size={22}/></div>
    <h3>{title}</h3><p>{body}</p></div>
}
function SectionHeading({kicker,title,description}:{kicker:string;title:string;description?:string}) {
  return <div className="section-head"><div><span className="kicker">{kicker}</span><h2>{title}</h2>
    {description&&<p>{description}</p>}</div></div>
}
function App() {
  const [data,setData]=useState<Dashboard>(FILLER)
  const [loadError,setLoadError]=useState('')
  const [loading,setLoading]=useState(true)
  const [refresh,setRefresh]=useState(0)
  const [tab,setTab]=useState<Tab>('rankings')
  const [menuOpen,setMenuOpen]=useState(false)
  const [station,setStation]=useState('ALL')
  const [element,setElement]=useState('tmp')
  const [days,setDays]=useState(7)
  const [lead,setLead]=useState<Lead>('24-48')
  useEffect(()=>{
    let mounted=true
    setLoading(true)
    fetch(import.meta.env.BASE_URL+'data/dashboard.json?refresh='+refresh,{cache:'no-store'})
      .then(response=>{if(!response.ok)throw Error('HTTP '+response.status);return response.json()})
      .then((value:Dashboard)=>{
        if(!mounted)return
        if(!Array.isArray(value.stations) || !Array.isArray(value.models))throw Error('Invalid data feed')
        setData(value);setLoadError('');setLoading(false)
      })
      .catch(error=>{if(mounted){setLoadError(String(error));setLoading(false)}})
    return()=>{mounted=false}
  },[refresh])

  const allScores=data.fairScores||[]
  const allDaily=data.dailyScores||[]
  const selectedElement=data.elements.find(x=>x.id===element)
  const unit=selectedElement?.unit||'°F'
  const comparedModels=data.comparisonProducts?.[element]?.[lead] || FILLER.comparisonProducts?.[element]?.[lead] || []
  const availableLeads=LEAD_OPTIONS.filter(x=>(data.comparisonProducts?.[element]?.[x.value] || FILLER.comparisonProducts?.[element]?.[x.value] || []).length>=2)
  const stationName=station==='ALL'?'All seven stations':data.stations.find(x=>x.id===station)?.name||station
  const leadLabel=LEAD_OPTIONS.find(x=>x.value===lead)?.label||lead
  const scoreRows=useMemo(()=>allScores.filter(x=>
    x.station===station&&x.element===element&&x.days===days&&x.lead===lead).sort(compare),
    [allScores,station,element,days,lead])
  const comparable = scoreRows.length===comparedModels.length && comparedModels.length>=2
    && scoreRows.every(row=>row.n===scoreRows[0].n)
  const n = comparable ? scoreRows[0].n : 0
  const leader = comparable ? scoreRows[0] : undefined
  const runnerUp = comparable ? scoreRows[1] : undefined
  const enough = n>=30
  const provisional = comparable && !enough
  const bestImprovement = leader && runnerUp && runnerUp.mae>0 ?
    100*(runnerUp.mae-leader.mae)/runnerUp.mae : null
  const isLegacy = !Array.isArray(data.fairScores)
  const stationRows=useMemo(()=>data.stations.map(s=>{
    const scores=allScores.filter(x=>x.station===s.id&&x.element===element&&x.days===days&&x.lead===lead).sort(compare)
    const same=scores.length===comparedModels.length && comparedModels.length>=2 && scores.every(row=>row.n===scores[0].n)
    return {id:s.id,name:s.name,scores:same?scores:[],n:same?scores[0].n:0}
  }),[allScores,data.stations,comparedModels.length,element,days,lead])
  const leadChart=useMemo(()=>availableLeads.map(item=>{
    const rows=allScores.filter(x=>x.station===station&&x.element===element&&x.days===days&&x.lead===item.value)
    const chartRow: Record<string,string|number|null>={name:item.short}
    data.models.forEach(m=>{chartRow[m.id]=rows.find(r=>r.model===m.id)?.mae??null})
    return chartRow
  }),[allScores,data.models,station,element,days,availableLeads.length])
  const trendChart=useMemo(()=>{
    const threshold=new Date(Date.now() - days*86400000).toISOString().slice(0,10)
    const entries=allDaily.filter(x=>x.station===station&&x.element===element&&x.lead===lead&&x.day>=threshold)
    const daysMap=new Map<string,Record<string,string|number|null>>()
    entries.forEach(entry=>{
      const item=daysMap.get(entry.day)||{name:entry.day}
      item[entry.model]=entry.mae
      daysMap.set(entry.day,item)
    })
    return [...daysMap.values()].sort((a,b)=>String(a.name).localeCompare(String(b.name)))
  },[allDaily,station,element,lead,days])
  const nav: {id:Tab; label:string;icon:typeof BarChart3;subtitle:string}[]=[
    {id:'rankings',label:'Which guidance is best?',icon:Target,subtitle:'Model rankings'},
    {id:'stations',label:'Compare stations',icon:MapPin,subtitle:'Where models excel'},
    {id:'percentiles',label:'NBM percentiles',icon:Layers3,subtitle:'Probability verification'},
    {id:'about',label:'How to read this',icon:HelpCircle,subtitle:'Methods & definitions'},
  ]
  const exportCSV=()=>{
    const columns=['station','element','days','lead_hours','model','matched_cases','mae','rmse','bias','closest_percent']
    const rows=allScores.map(x=>[x.station,x.element,String(x.days),x.lead,x.model,String(x.n),
      String(x.mae),String(x.rmse),String(x.bias),String(x.winRate)])
    safeDownload([columns,...rows].map(row=>row.join(',')).join('\n'),'common-case-model-verification.csv')
  }

  return <div className="app-root">
    <aside className={'side '+(menuOpen?'open':'')} aria-label="Navigation">
      <div className="brand"><span className="brand-icon"><Gauge size={23}/></span>
        <div><strong>GUIDANCE<span> / </span>VERIFY</strong><small>GULF SOUTH · VERIFICATION</small></div>
        <button className="icon-only close-menu" aria-label="Close menu" onClick={()=>setMenuOpen(false)}><X size={20}/></button></div>
      <div className="nav-title">EXPLORE</div>
      <nav>
        {nav.map(item=><button key={item.id} className={'nav-item '+(tab===item.id?'current':'')}
          onClick={()=>{setTab(item.id);setMenuOpen(false)}}>
          <item.icon size={19} strokeWidth={1.9}/>
          <span><strong>{item.label}</strong><small>{item.subtitle}</small></span>
          {tab===item.id&&<span className="nav-indicator"/>}
        </button>)}
      </nav>
      <div className="side-bottom">
        <div className="data-status"><span className={'status-dot '+(data.dataStatus==='active'?'active':'')}/>
          <div><strong>{data.dataStatus==='active'?'Archive collecting':'Waiting for first ingestion'}</strong>
            <small>Last update: {formatUpdated(data.generatedAt)}</small></div></div>
        <p>Independent station-based research.<br/>Not an official NWS product.</p>
      </div>
    </aside>
    {menuOpen&&<button className="menu-backdrop" aria-label="Close navigation" onClick={()=>setMenuOpen(false)}/>}
    <div className="workspace">
      <header className="topbar">
        <div className="topbar-left"><button className="icon-only open-menu" aria-label="Open menu" onClick={()=>setMenuOpen(true)}><Menu size={21}/></button>
          <span className="app-label">MODEL VERIFICATION</span><span className="crumb">/</span>
          <span className="current-page">{nav.find(x=>x.id===tab)?.label}</span></div>
        <div className="topbar-right">
          <span className="update-time"><span className={'status-dot '+(data.dataStatus==='active'?'active':'')}/> Updated {formatUpdated(data.generatedAt)}</span>
          <button className="icon-only" aria-label="Refresh verification data" title="Refresh" onClick={()=>setRefresh(x=>x+1)}><RefreshCw size={18} className={loading?'spin':''}/></button>
          <a className="repo-link" href="https://github.com/JacZerin24/model-verification-dashboard" target="_blank" rel="noreferrer">GitHub <ExternalLink size={13}/></a>
        </div>
      </header>
      <main className="page">
        {loadError&&<div className="alert danger"><CircleAlert size={18}/> Couldn't load verification data: {loadError}. Rankings are unavailable.</div>}
        {(data.quality?.warnings?.length||0)>0&&<details className="alert warning"><summary><CircleAlert size={17}/> {data.quality?.warnings?.length} data feed warning(s) in the latest update. <ChevronDown size={15}/></summary>
          <ul>{data.quality?.warnings?.slice(0,15).map((x,i)=><li key={i}>{x}</li>)}</ul></details>}
        {tab==='rankings'||tab==='stations'?<>
          <div className="intro">
            <div className="eyebrow"><span className="mini-bar"/> FORECAST VERIFICATION · GULF SOUTH</div>
            <h1>{tab==='rankings'?'What guidance has been':'Where has each model been'}<br/><span>{tab==='rankings'?'most accurate lately?':'most accurate?'}</span></h1>
            <p>{tab==='rankings'?'A clear look at which guidance has been closest to observations—not another display of upcoming forecasts.':
              'See which guidance has verified best at each airport, using the same weather cases for every compared product.'}</p>
          </div>
          <section className="filters" aria-label="Choose verification criteria">
            <div className="filters-head"><div><SlidersHorizontal size={17}/><strong>Your comparison</strong></div>
              <span>Change any filter to update the results</span></div>
            <div className="filter-grid">
              <SelectField id="station" label="Where?" value={station} onChange={setStation} icon={MapPin}
                options={[{value:'ALL',label:'All 7 stations · regional view'},...data.stations.map(x=>({value:x.id,label:x.id+' · '+x.name}))]}/>
              <SelectField id="element" label="Weather element" value={element} onChange={x=>{setElement(x);if(x==='gst'&&(lead==='0-12'||lead==='12-24'))setLead('24-48')}} icon={Thermometer}
                options={data.elements.map(x=>({value:x.id,label:x.label}))}/>
              <SelectField id="period" label="How recently?" value={String(days)} onChange={x=>setDays(Number(x))} icon={Clock3}
                options={[{value:'7',label:'Past 7 days'},{value:'30',label:'Past 30 days'}]}/>
              <SelectField id="lead" label="Forecast lead time" value={lead} onChange={x=>setLead(x as Lead)} icon={Activity}
                options={availableLeads.map(x=>({value:x.value,label:x.label}))}/>
            </div>
            <p className="filter-hint"><Info size={14}/> Lead time is how far ahead the forecast was made. A 24–48 hour forecast was made roughly 1–2 days before the weather occurred.</p>
          </section>
          {tab==='rankings'?<>
            <section className="result-hero" aria-live="polite">
              <div className="result-topline">
                <span className="eyebrow">YOUR RESULTS</span>
                <span className={'tag '+(enough?'ready':'caution')}>{enough?<><Check size={13}/> 30+ matched cases</>:<><Clock3 size={13}/> {provisional?'Early results':'Building verification archive'}</>}</span>
              </div>
              <div className="result-layout">
                <div className="result-main">
                  <p className="result-label">{enough?'Lowest average forecast error':provisional?'Current lowest error · preliminary':'No ranking available yet'}</p>
                  <h2>{leader?friendly(leader.model):'Collecting matching cases'}</h2>
                  <p className="result-explainer">
                    {enough?'This product has the lowest MAE among guidance verified on the same cases.':
                      provisional?'This product is currently lowest, but the sample is too small to identify a dependable leader.':
                      isLegacy?'The updated common-case comparison is being generated by the next data pipeline run.':
                      'A ranking requires an observation and forecasts from all products available in this comparison for the same station, time and lead range.'}
                  </p>
                  {leader&&<div className="result-mini"><span><MapPin size={14}/>{stationName}</span><span><Clock3 size={14}/>{days} days · {leadLabel}</span></div>}
                </div>
                <div className="leader-numbers">
                  <div className="leader-number"><span>Average error (MAE)</span><strong>{leader?metric(leader.mae):'—'} <small>{leader?unit:''}</small></strong><p>Lower is better</p></div>
                  <div className="leader-number"><span>Identical verifying cases</span><strong>{comparable?n:'—'}</strong><p>Same sample for compared products</p></div>
                </div>
              </div>
            </section>
            <div className="metrics-note">
              <div><ShieldCheck size={18}/><span><strong>Fair comparison.</strong> All compared products are evaluated against identical station/time observations.</span></div>
              <button className="inline-link" onClick={()=>setTab('about')}>How scoring works <ArrowRight size={14}/></button>
            </div>
            <section className="surface scorecard">
              <SectionHeading kicker="01 · THE LEADERBOARD" title="Guidance ranked by accuracy" description="Average absolute error (MAE) is the main score. A smaller number means the forecast was closer to what happened."/>
              <div className="models-compared">Comparing {comparedModels.map(friendly).join(' · ')} <span>({comparedModels.length} products)</span></div>
              {comparable?<div className="ranking-list">
                <div className="rank-head"><span>GUIDANCE PRODUCT</span><span>AVERAGE ERROR · LOWER IS BETTER</span><span>MEAN BIAS</span><span>CLOSEST MOST OFTEN</span></div>
                {scoreRows.map((row,i)=>{
                  const largest=Math.max(...scoreRows.map(r=>r.mae),0.01)
                  return <div className={'ranking-row '+(i===0?'top-rank':'')} key={row.model}>
                    <div className="model-name"><span className="rank-num">{String(i+1).padStart(2,'0')}</span>
                      <span className="model-swatch" style={{background:COLOR[row.model]||'#8792a0'}}/>
                      <div><strong>{friendly(row.model)}</strong><small>{row.model==='GFS'||row.model==='NAM'?'Statistical MOS guidance':'National Blend guidance'}</small></div>
                    </div>
                    <div className="error-cell"><div><strong>{metric(row.mae)} <small>{unit}</small></strong>{i===0&&<span className="best-label">Lowest MAE</span>}</div>
                      <div className="error-bar"><span style={{width:(row.mae/largest*100)+'%',background:COLOR[row.model]||'#8792a0'}}/></div></div>
                    <div className="bias-cell"><strong className={row.bias>0?'above':row.bias<0?'below':''}>{signed(row.bias)} <small>{unit}</small></strong><small>{row.bias>0?'Forecast too high':row.bias<0?'Forecast too low':'No overall bias'}</small></div>
                    <div className="win-cell"><strong>{metric(row.winRate,1)}%</strong><small>Lowest error, with ties shared</small></div>
                  </div>
                })}
                <div className="ranking-footer"><span><Info size={15}/> {n} matched station/time cases per model · {confidence(n)}.</span>
                  {bestImprovement!==null&&bestImprovement>0&&<span>First vs. second: {metric(bestImprovement,1)}% lower MAE (descriptive only)</span>}</div>
              </div>:<Placeholder title="Not enough shared verification cases yet" body="The archive is collecting guidance automatically. Results appear only when every product in the comparison has a forecast matched to the same observed weather event."/>}
            </section>
            <div className="split-panels">
              <section className="surface chart-panel"><SectionHeading kicker="02 · BY FORECAST LEAD" title="When does each model do best?" description="Average error at different forecast horizons. This helps distinguish short- from longer-range skill."/>
                {leadChart.some(row=>data.models.some(m=>row[m.id]!==null))?<PerformanceChart data={leadChart} models={data.models} unit={unit} xFormatter={x=>x} />:
                  <Placeholder title="Lead-time breakdown will appear here" body="The comparison needs matched observations across all four guidance products for each lead-time range."/>}
              </section>
              <section className="surface chart-panel"><SectionHeading kicker="03 · RECENT TREND" title="Has accuracy been changing?" description="Daily mean absolute error for the selected station, element and forecast lead."/>
                {trendChart.length>0?<PerformanceChart data={trendChart} models={data.models} unit={unit} xFormatter={x=>new Date(String(x)+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'})}/>:
                  <Placeholder title="Daily trends are building" body="This panel fills as comparable cases verify over multiple days."/>}
              </section>
            </div>
            <div className="bottom-actions"><span><Info size={15}/> Currently available: NBM Short, NBM Extended, GFS MOS and NAM MOS. Raw GFS/NAM/ECMWF and NBM percentiles are not yet scored.</span>
              <button className="download-action" onClick={exportCSV}><Download size={16}/> Download verified scores</button></div>
          </>:<>
            <section className="surface station-section">
              <SectionHeading kicker="STATION COMPARISON" title="Which guidance has verified best at each station?" description="Each station's ranking uses the same cases across the four guidance products. Small samples are marked as preliminary."/>
              <div className="station-table-wrapper"><table className="station-table">
                <thead><tr><th>STATION</th><th>LOWEST ERROR</th><th>MAE</th><th>VERIFIED CASES</th><th>ASSESSMENT</th></tr></thead>
                <tbody>{stationRows.map(row=><tr key={row.id}>
                  <td><strong>{row.id}</strong><span>{row.name}</span></td>
                  <td>{row.scores.length?<span className="table-model"><i style={{background:COLOR[row.scores[0].model]}}/>{friendly(row.scores[0].model)}</span>:'Awaiting cases'}</td>
                  <td className="mono">{row.scores.length?metric(row.scores[0].mae)+' '+unit:'—'}</td>
                  <td className="mono">{row.n||'—'}</td>
                  <td><span className={'sample-flag '+(row.n>=30?'strong':'weak')}>{row.n>=30?'30+ matched':row.n>0?'Preliminary':'No common cases'}</span></td>
                </tr>)}</tbody>
              </table></div>
              <p className="table-note">A station is not compared against another station's MAE as a measure of relative forecast skill; this view identifies the lowest-error guidance at each location.</p>
            </section>
            <div className="go-deeper"><div><strong>Want to inspect one location?</strong><p>Choose a station above to see its complete ranked leaderboard.</p></div>
              <button onClick={()=>setTab('rankings')}>View full rankings <ArrowRight size={16}/></button></div>
          </>}
        </>:tab==='percentiles'?<div className="secondary-page">
          <div className="eyebrow"><span className="mini-bar"/> NBM · PROBABILISTIC VERIFICATION</div>
          <h1>How well are NBM<br/><span>percentiles verifying?</span></h1>
          <p className="page-subtitle">The eventual goal is to identify which NBM percentiles are most useful for each station and weather element—not just whether the median forecast is accurate.</p>
          <section className="percentile-status"><div className="status-heading"><CircleAlert size={22}/><span>Actual QMD percentile verification is not active yet</span></div>
            <p>The current station archive contains NBM Short and Extended text guidance, not the full gridded NBM P05–P95 quantile distributions. Percentile skill cannot be calculated from those records. This page will only show measured calibration once QMD ingestion and case matching are validated.</p>
            <span className="safe-status"><ShieldCheck size={16}/> No fabricated percentile or coverage statistics</span>
          </section>
          <div className="percentile-grid">
            <article className="surface percentile-card"><span className="step">01</span><h2>Which percentile performs best?</h2><p>Compare P10, P25, P50, P75 and P90 with observations using quantile loss. Report results by station, element and lead time.</p><span className="work-tag">QMD ingestion required</span></article>
            <article className="surface percentile-card"><span className="step">02</span><h2>Is the NBM spread realistic?</h2><p>Check whether 50% and 80% forecast intervals contain observations at their expected frequencies. Separate calibration from sharpness.</p><span className="work-tag">Coverage verification required</span></article>
            <article className="surface percentile-card"><span className="step">03</span><h2>When should forecasters adjust?</h2><p>Look for consistent underdispersion, warm/cold biases and forecast-regime dependencies once enough archived percentile cases exist.</p><span className="work-tag">Historical cases required</span></article>
          </div>
          <div className="next-phase"><Target size={23}/><div><strong>Next development priority</strong><p>Archive real NBM QMD percentiles at each airport and compare their quantile scores and coverage to observed temperature, dew point and winds.</p></div></div>
        </div>:<div className="secondary-page">
          <div className="eyebrow"><span className="mini-bar"/> VERIFICATION GUIDE</div>
          <h1>Understand the numbers.<br/><span>Trust the comparison.</span></h1>
          <p className="page-subtitle">The interface is built to answer one practical question: what guidance has actually been closest to observed weather recently?</p>
          <div className="method-grid">
            <article className="surface method-card"><span className="method-icon"><Target size={22}/></span><h2>MAE: average error</h2><p>Mean Absolute Error measures the average size of forecast misses, regardless of direction. Lower MAE means forecasts were closer to observations. That's how the leaderboard is ordered.</p></article>
            <article className="surface method-card"><span className="method-icon"><TrendingDown size={22}/></span><h2>Bias: which direction?</h2><p>Mean forecast minus observed value. Positive means guidance was too high (warmer, moister, windier). Negative means it was too low. A near-zero bias does not guarantee small errors.</p></article>
            <article className="surface method-card"><span className="method-icon"><BarChart3 size={22}/></span><h2>Closest most often</h2><p>The share of verifying cases where a product has the smallest absolute error. Ties split the credit. This complements MAE but is not the primary ranking metric.</p></article>
            <article className="surface method-card"><span className="method-icon"><ShieldCheck size={22}/></span><h2>What makes a fair ranking?</h2><p>Every included product must forecast the same station, weather element and valid time within the selected lead-time bucket. For multiple cycles in one bucket, the run nearest the bucket midpoint is used. The verifying observation is identical for every product.</p></article>
          </div>
          <section className="surface caveat-box">
            <h2>Important limits to keep in mind</h2>
            <ul>
              <li><strong>Small samples:</strong> fewer than 30 matched cases are marked preliminary; rankings alone do not establish statistically significant differences.</li>
              <li><strong>Lead windows:</strong> comparisons are within lead-time ranges, not identical exact initialization times. The archive is still accumulating.</li>
              <li><strong>Guidance identity:</strong> GFS MOS and NAM MOS are statistically postprocessed guidance, not raw deterministic GFS or NAM. NBM Short/Extended are station text guidance, not QMD quantiles.</li>
              <li><strong>Wind verification:</strong> station exposure, averaging periods and gust definitions may differ from model guidance; these are exploratory comparisons.</li>
              <li><strong>Data sources:</strong> Iowa Environmental Mesonet station model guidance and METAR/ASOS archive; observations matched within 40 minutes of model valid time.</li>
            </ul>
            <a href="https://github.com/JacZerin24/model-verification-dashboard" target="_blank" rel="noreferrer">Inspect methodology and source code <ExternalLink size={15}/></a>
          </section>
        </div>}
        <footer><span>GUIDANCE / VERIFY <span className="footer-divider">·</span> Independent research tool</span>
          <span>Forecast guidance is not a guarantee · Timestamps shown in Central Time</span></footer>
      </main>
    </div>
  </div>
}

function PerformanceChart({data,models,unit,xFormatter}:{data:Record<string,string|number|null>[];models:Model[];unit:string;xFormatter:(s:string)=>string}) {
  const hasPoints=data.some(r=>models.some(m=>typeof r[m.id]==='number'))
  if(!hasPoints)return <Placeholder title="Not enough cases" body="Shared verification cases will be plotted here when they accumulate."/>
  return <div className="chart-area">
    <div className="legend">{models.map(m=><span key={m.id}><i style={{background:COLOR[m.id]||'#777'}}/>{friendly(m.id)}</span>)}</div>
    <ResponsiveContainer width="100%" height={275}>
      <LineChart data={data} margin={{top:12,right:13,left:0,bottom:3}}>
        <CartesianGrid vertical={false} stroke="#e4ebed" strokeDasharray="3 5"/>
        <XAxis dataKey="name" tick={{fontSize:10,fill:'#677b89'}} tickLine={false} axisLine={false}
          tickFormatter={xFormatter} minTickGap={20}/>
        <YAxis width={42} tick={{fontSize:10,fill:'#677b89'}} tickLine={false} axisLine={false}
          domain={[0,'auto']} tickFormatter={(v:number)=>String(v)}/>
        <Tooltip labelFormatter={v=>xFormatter(String(v))}
          formatter={v=>[metric(Number(v))+' '+unit,'MAE']}
          contentStyle={{borderRadius:9,border:'1px solid #d7e3e8',fontSize:12,boxShadow:'0 8px 25px #11304d16'}}/>
        {models.map(m=><Line key={m.id} type="monotone" dataKey={m.id} name={friendly(m.id)}
          stroke={COLOR[m.id]||'#777'} strokeWidth={2.5} dot={{r:3}} activeDot={{r:5}} connectNulls={false}/>)}
      </LineChart>
    </ResponsiveContainer>
    <p className="chart-foot"><Info size={14}/> Lower lines = smaller average error. Missing points mean no matched cases.</p>
  </div>
}
export default App
