import { useEffect, useMemo, useState } from 'react'
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3,
  BookOpen, CalendarDays, CheckCircle2, ChevronDown, CircleAlert, CloudSun,
  Database, Download, ExternalLink, Gauge, LayoutDashboard, MapPin,
  Menu, RefreshCw, SlidersHorizontal, Target, Thermometer, Wind, X,
} from 'lucide-react'
import {
  CartesianGrid, Legend, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'

type Station = { id: string; name: string; lat?: number; lon?: number }
type Model = { id: string; label: string; family?: string }
type Element = { id: string; label: string; unit: string }
type Score = { station: string; model: string; element: string; days: number; lead: string; n: number; mae: number; rmse: number; bias: number }
type Forecast = { station: string; model: string; init: string; valid: string; lead: number; tmp?: number|null; dpt?: number|null; wsp?: number|null; gst?: number|null }
type Observation = { station: string; valid: string; tmp?: number|null; dpt?: number|null; wsp?: number|null; gst?: number|null }
type Pair = { station: string; model: string; element: string; valid: string; init: string; lead: number; forecast: number; observed: number; error: number }
type Dashboard = {
  generatedAt: string|null; dataStatus: string; stations: Station[]; models: Model[];
  elements: Element[]; leadBins: string[]; scores: Score[];
  latestForecasts: Forecast[]; recentObservations: Observation[]; recentPairs: Pair[];
  quality: { forecastRecords: number; observationRecords: number; matchedElementPairs30d: number;
    warnings: string[]; observationToleranceMinutes: number; archiveDays: number; NBMPercentilesAvailable: boolean }
}

const MODEL_COLORS: Record<string, string> = {
  NBS: '#65dfc7', NBE: '#7d9cff', GFS: '#ffcb7c', NAM: '#ed95c3',
}
const MODEL_ORDER = ['NBS','NBE','GFS','NAM']
const FALLBACK: Dashboard = {
  generatedAt: null, dataStatus: 'awaiting_data',
  stations: [
    {id:'KBTR',name:'Baton Rouge'}, {id:'KMSY',name:'New Orleans Intl'},
    {id:'KHDC',name:'Hammond'}, {id:'KNEW',name:'New Orleans Lakefront'},
    {id:'KASD',name:'Slidell'}, {id:'KMCB',name:'McComb'}, {id:'KGPT',name:'Gulfport'},
  ],
  models: [
    {id:'NBS',label:'NBM Short'}, {id:'NBE',label:'NBM Extended'},
    {id:'GFS',label:'GFS MOS'}, {id:'NAM',label:'NAM MOS'},
  ],
  elements: [{id:'tmp',label:'Temperature',unit:'°F'}, {id:'dpt',label:'Dew point',unit:'°F'},
    {id:'wsp',label:'Wind speed',unit:'kt'}, {id:'gst',label:'Wind gust',unit:'kt'}],
  leadBins:['all','0-12','12-24','24-48','48-72','72-120','120+'],
  scores:[],latestForecasts:[],recentObservations:[],recentPairs:[],
  quality:{forecastRecords:0,observationRecords:0,matchedElementPairs30d:0,warnings:[],
    observationToleranceMinutes:40,archiveDays:35,NBMPercentilesAvailable:false},
}
type Page = 'overview'|'explorer'|'probabilistic'|'methods'

function formatDate(s?: string|null) {
  if (!s) return 'Awaiting first update'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return 'Time unavailable'
  return new Intl.DateTimeFormat('en-US', { timeZone:'America/Chicago', month:'short', day:'numeric',
    hour:'numeric', minute:'2-digit', timeZoneName:'short' }).format(d)
}
function shortTime(s: string) {
  const d = new Date(s)
  return new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',
    hour:'numeric'}).format(d)
}
function number(value?: number|null, digits=1) {
  return value === undefined || value === null || !Number.isFinite(value) ? '—' : value.toFixed(digits)
}
function signed(value?: number|null) {
  return value === undefined || value === null ? '—' : (value > 0 ? '+' : '') + value.toFixed(2)
}
function TitleRow({eyebrow,title,description}:{eyebrow:string;title:string;description:string}) {
  return <div className="section-title"><div className="eyebrow">{eyebrow}</div><h2>{title}</h2><p>{description}</p></div>
}
function EmptyState({title,description}:{title:string;description:string}) {
  return <div className="empty"><div className="empty-icon"><Activity size={22}/></div><h3>{title}</h3><p>{description}</p></div>
}

export default function App() {
  const [data,setData] = useState<Dashboard>(FALLBACK)
  const [loading,setLoading] = useState(true)
  const [loadError,setLoadError] = useState('')
  const [page,setPage] = useState<Page>('overview')
  const [station,setStation] = useState('KBTR')
  const [element,setElement] = useState('tmp')
  const [days,setDays] = useState(7)
  const [lead,setLead] = useState('all')
  const [menuOpen,setMenuOpen] = useState(false)
  const [refreshKey,setRefreshKey] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    fetch(import.meta.env.BASE_URL + 'data/dashboard.json?refresh=' + refreshKey, {cache:'no-store'})
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
      .then((payload: Dashboard) => {
        if (!active) return
        if (!Array.isArray(payload.scores) || !Array.isArray(payload.stations)) throw new Error('Invalid data format')
        setData(payload); setLoadError(''); setLoading(false)
      })
      .catch((err: Error) => { if (active) {setLoadError(err.message); setLoading(false)} })
    return () => { active=false }
  },[refreshKey])

  const unit = data.elements.find(x => x.id === element)?.unit || '°F'
  const selectedStation = data.stations.find(s => s.id === station)
  const scores = useMemo(() => data.scores
    .filter(x=>x.station===station && x.element===element && x.days===days && x.lead===lead)
    .sort((a,b)=>a.mae-b.mae), [data,station,element,days,lead])
  const total = scores.reduce((sum,score)=>sum+score.n,0)
  const best = scores[0]
  const weightedBias = total ? scores.reduce((n,x)=>n+x.bias*x.n,0)/total : null
  const forecastChart = useMemo(() => {
    const points = new Map<string, Record<string,string|number|null>>()
    const upsert = (valid:string, key:string, value:number) => {
      const item = points.get(valid) || {valid}
      item[key]=value; points.set(valid,item)
    }
    data.recentObservations.filter(x=>x.station===station).forEach(x=>{
      const value = x[element as keyof Observation]
      if (typeof value === 'number') upsert(x.valid,'observed',value)
    })
    data.latestForecasts.filter(x=>x.station===station).forEach(x=>{
      const value = x[element as keyof Forecast]
      if (typeof value === 'number') upsert(x.valid,x.model,value)
    })
    return [...points.values()].sort((a,b)=>String(a.valid).localeCompare(String(b.valid)))
  },[data,station,element])
  const latestRuns = useMemo(() => {
    const entries = new Map<string,string>()
    data.latestForecasts.filter(x=>x.station===station).forEach(x=>{
      if (!entries.has(x.model)||entries.get(x.model)!<x.init) entries.set(x.model,x.init)
    })
    return entries
  },[data,station])
  const recentPairs = useMemo(() => data.recentPairs
    .filter(x=>x.station===station&&x.element===element)
    .sort((a,b)=>b.valid.localeCompare(a.valid)).slice(0,8),[data,station,element])
  const nav: {id:Page;icon:typeof LayoutDashboard;label:string;sub:string}[] = [
    {id:'overview',icon:LayoutDashboard,label:'Overview',sub:'Verification scores'},
    {id:'explorer',icon:Activity,label:'Forecast explorer',sub:'Latest station runs'},
    {id:'probabilistic',icon:Target,label:'NBM percentiles',sub:'Calibration roadmap'},
    {id:'methods',icon:BookOpen,label:'Data & methods',sub:'Sources and limitations'},
  ]
  const download = () => {
    const rows = [['station','model','element','period_days','lead_hours','n','mae','rmse','bias'],
      ...data.scores.map(x=>[x.station,x.model,x.element,String(x.days),x.lead,String(x.n),
        String(x.mae),String(x.rmse),String(x.bias)])]
    const csv=rows.map(row=>row.map(cell=>'"'+cell.replace(/"/g,'""')+'"').join(',')).join('\n')
    const href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}))
    const a=document.createElement('a'); a.href=href;a.download='model-verification-scores.csv';a.click()
    URL.revokeObjectURL(href)
  }

  return <div className="app">
    <aside className={'sidebar '+(menuOpen?'sidebar-open':'')}>
      <div className="brand"><div className="brand-glyph"><Gauge size={23} strokeWidth={2.1}/></div>
        <div><div className="brand-title">MODEL<span> / </span>VERIFY</div><div className="brand-subtitle">GULF SOUTH · LAB 01</div></div>
        <button className="icon-button sidebar-close" aria-label="Close menu" onClick={()=>setMenuOpen(false)}><X size={20}/></button>
      </div>
      <div className="nav-section-label">WORKSPACE</div>
      <nav aria-label="Main navigation">
        {nav.map(item=><button key={item.id} className={'nav-item '+(page===item.id?'active':'')}
          onClick={()=>{setPage(item.id);setMenuOpen(false)}}>
          <item.icon size={18} strokeWidth={1.8}/>
          <span><strong>{item.label}</strong><small>{item.sub}</small></span>
          {page===item.id&&<span className="nav-marker"/>}
        </button>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="side-status"><span className={'dot '+(data.dataStatus==='active'?'green':'amber')}/>
          <span><strong>{data.dataStatus==='active'?'Pipeline active':'Collecting data'}</strong><small>Automatic archive · 3-hour cycle</small></span>
        </div>
        <div className="sidebar-foot">Independent verification research<br/>Not an official NWS product</div>
      </div>
    </aside>
    {menuOpen&&<button className="scrim" aria-label="Close navigation" onClick={()=>setMenuOpen(false)}/>}
    <main className="main">
      <header className="topbar">
        <div className="topbar-left"><button className="icon-button menu-trigger" aria-label="Open navigation" onClick={()=>setMenuOpen(true)}><Menu size={22}/></button>
          <span className="topbar-label">VERIFICATION OPERATIONS</span><span className="slash">/</span>
          <span className="topbar-crumb">{nav.find(x=>x.id===page)?.label}</span></div>
        <div className="topbar-right"><span className="updated">Updated {formatDate(data.generatedAt)}</span>
          <button className="icon-button refresh" aria-label="Refresh data" title="Refresh data" onClick={()=>setRefreshKey(x=>x+1)}><RefreshCw size={17} className={loading?'spin':''}/></button>
          <a className="github-link" href="https://github.com/JacZerin24/model-verification-dashboard" target="_blank" rel="noreferrer"><span>Repository</span><ExternalLink size={15}/></a>
        </div>
      </header>

      <div className="content">
        <div className="masthead"><div className="masthead-copy">
          <div className="overline"><span className="overline-line"/> OPERATIONAL FORECAST SCIENCE <span className="release">V0.1</span></div>
          <h1>{page==='overview'?'Model performance,':page==='explorer'?'Forecast trajectories,':page==='probabilistic'?'Beyond the median,':'Data you can trust,'}
            <br/><em>{page==='overview'?'made measurable.':page==='explorer'?'station by station.':page==='probabilistic'?'toward calibration.':'methods you can audit.'}</em></h1>
          <p className="masthead-description">
            {page==='overview'?'Compare archived model guidance against observed conditions across the Gulf South. Every score is based on actual matched forecast–observation pairs.':
              page==='explorer'?'Examine the latest archived guidance alongside recent airport observations, with model cycles preserved for later verification.':
              page==='probabilistic'?'The next milestone is direct NBM QMD quantile extraction and proper probabilistic reliability verification.':
              'Transparent provenance, matched-case methodology, model identity and the known limitations of station-based verification.'}
          </p>
        </div><div className="masthead-decoration" aria-hidden="true"><span className="radar-circle c1"/><span className="radar-circle c2"/><span className="radar-circle c3"/><span className="radar-center"/><span className="radar-line"/></div></div>

        {loadError&&<div className="notice error"><CircleAlert size={18}/> Dashboard JSON could not be loaded ({loadError}). Displaying the empty-state shell; no scores are being inferred.</div>}
        {data.quality.warnings?.length>0&&<details className="notice warning">
          <summary><CircleAlert size={17}/> Some feeds failed during the last update ({data.quality.warnings.length}). Previously archived records are retained. <ChevronDown size={15}/></summary>
          <ul>{data.quality.warnings.slice(0,15).map((s,i)=><li key={i}>{s}</li>)}</ul>
        </details>}

        {(page==='overview'||page==='explorer')&&<div className="filterbar">
          <div className="filter-item station-filter"><label htmlFor="station">STATION</label>
            <div className="select-wrap"><MapPin size={16}/><select id="station" value={station} onChange={e=>setStation(e.target.value)}>
              {data.stations.map(x=><option value={x.id} key={x.id}>{x.id} · {x.name}</option>)}
            </select><ChevronDown size={15}/></div></div>
          <div className="filter-item"><label htmlFor="element">ELEMENT</label>
            <div className="select-wrap"><Thermometer size={16}/><select id="element" value={element} onChange={e=>setElement(e.target.value)}>
              {data.elements.map(x=><option value={x.id} key={x.id}>{x.label}</option>)}
            </select><ChevronDown size={15}/></div></div>
          {page==='overview'&&<><div className="filter-item small-filter"><label htmlFor="period">PERIOD</label>
            <div className="select-wrap"><CalendarDays size={16}/><select id="period" value={days} onChange={e=>setDays(Number(e.target.value))}>
              <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option>
            </select><ChevronDown size={15}/></div></div>
          <div className="filter-item small-filter"><label htmlFor="lead">FORECAST LEAD</label>
            <div className="select-wrap"><SlidersHorizontal size={16}/><select id="lead" value={lead} onChange={e=>setLead(e.target.value)}>
              {data.leadBins.map(x=><option key={x} value={x}>{x==='all'?'All leads':x==='120+'?'120+ hours':x+' hours'}</option>)}
            </select><ChevronDown size={15}/></div></div></>}
        </div>}

        {page==='overview'&&<>
          <div className="context-line"><span><MapPin size={13}/> {station} · {selectedStation?.name||'Station'}</span><span className="context-rule"/><span>{data.elements.find(x=>x.id===element)?.label} verification</span><span className="context-rule"/><span>Forecast − observation</span></div>
          <div className="kpi-grid">
            <div className="kpi"><span className="kpi-label">LOWEST MEAN ABSOLUTE ERROR</span>
              <div className="kpi-value">{best?number(best.mae,2):'—'}<small>{best?unit:''}</small></div>
              <div className="kpi-foot"><span className="accent"><Target size={14}/>{best?data.models.find(m=>m.id===best.model)?.label:'No verified scores yet'}</span></div></div>
            <div className="kpi"><span className="kpi-label">MATCHED FORECAST–OBS PAIRS</span>
              <div className="kpi-value">{total?total.toLocaleString():'—'}</div>
              <div className="kpi-foot"><span>{total?'Sum across available guidance':'Awaiting valid forecasts & METARs'}</span></div></div>
            <div className="kpi"><span className="kpi-label">WEIGHTED MEAN BIAS</span>
              <div className="kpi-value">{weightedBias===null?'—':signed(weightedBias)}<small>{weightedBias===null?'':unit}</small></div>
              <div className="kpi-foot"><span>{weightedBias===null?'No matched samples':'Positive = guidance too high'}</span></div></div>
            <div className="kpi"><span className="kpi-label">GUIDANCE PRODUCTS VERIFIED</span>
              <div className="kpi-value">{scores.length}<small> / {data.models.length}</small></div>
              <div className="kpi-foot"><span>{scores.length?'Products with valid matches':'Scores appear as cases accumulate'}</span></div></div>
          </div>
          <div className="two-col">
            <section className="panel performance">
              <div className="panel-header"><div><span className="eyebrow">01 / PERFORMANCE</span><h3>Model ranking</h3><p>MAE by guidance product · lower is better</p></div><BarChart3 size={20} className="panel-icon"/></div>
              {scores.length?<div className="bar-stack">{scores.map((s,i)=><div className="rank-row" key={s.model}>
                <div className="rank-label"><span className="rank-index">{String(i+1).padStart(2,'0')}</span><div><strong>{data.models.find(x=>x.id===s.model)?.label||s.model}</strong><small>{s.n} matched pairs{s.n<30?' · small sample':''}</small></div></div>
                <div className="rank-viz"><div className="rank-track"><div className="rank-fill" style={{width:(100*s.mae/Math.max(...scores.map(x=>x.mae),0.1))+'%',background:MODEL_COLORS[s.model]||'#7d9cff'}}/></div>
                  <strong>{number(s.mae,2)} <small>{unit}</small></strong></div>
              </div>)}</div>:<EmptyState title="Rankings are building" description="Forecasts must be archived before their valid times. The pipeline will score them once matching observations are available."/>}
            </section>
            <section className="panel">
              <div className="panel-header"><div><span className="eyebrow">02 / SCORECARD</span><h3>Verification breakdown</h3><p>Common selection, separate model sample sizes</p></div><Gauge size={20} className="panel-icon"/></div>
              <div className="table-scroll"><table><thead><tr><th>GUIDANCE</th><th>MAE</th><th>RMSE</th><th>BIAS</th><th>N</th></tr></thead>
                <tbody>{scores.length?scores.map(s=><tr key={s.model}><td><span className="model-dot" style={{background:MODEL_COLORS[s.model]}}/>{s.model}</td><td>{number(s.mae,2)}</td><td>{number(s.rmse,2)}</td><td className={s.bias>0?'warm':s.bias<0?'cool':''}>{signed(s.bias)}</td><td>{s.n}</td></tr>)
                  :<tr><td colSpan={5} className="no-data-table">No verified cases in this selection</td></tr>}</tbody></table></div>
              <div className="panel-bottom"><CircleAlert size={15}/><span>Different guidance products may have different available valid times. Rankings are descriptive, not common-case skill comparisons yet.</span></div>
            </section>
          </div>
          <section className="panel full-width">
            <div className="panel-header"><div><span className="eyebrow">03 / STATION TIME SERIES</span><h3>Observed vs latest guidance</h3><p>Recent METAR observations and the latest available station forecast for each product</p></div><div className="panel-chip">CENTRAL TIME</div></div>
            <ForecastGraph points={forecastChart} unit={unit} />
          </section>
          <div className="action-line"><span><Database size={16}/> {data.quality.forecastRecords.toLocaleString()} forecast records · {data.quality.observationRecords.toLocaleString()} observation reports in rolling archive</span>
            <button className="text-action" onClick={download}><Download size={16}/> Export score CSV <ArrowRight size={15}/></button></div>
        </>}

        {page==='explorer'&&<>
          <div className="explorer-grid">
            <section className="panel full-width">
              <div className="panel-header"><div><span className="eyebrow">LIVE ARCHIVE / STATION</span><h3>{station} · latest available runs</h3><p>{data.elements.find(x=>x.id===element)?.label} in {unit}; observational history and currently archived MOS guidance</p></div><div className="panel-chip">CENTRAL TIME</div></div>
              <ForecastGraph points={forecastChart} unit={unit}/>
            </section>
            <section className="panel">
              <div className="panel-header"><div><span className="eyebrow">MODEL INVENTORY</span><h3>Run provenance</h3><p>Latest archived issue/init time by product</p></div><Database size={19} className="panel-icon"/></div>
              <div className="run-list">{data.models.map(m=><div className="run-row" key={m.id}>
                <span className="model-dot" style={{background:MODEL_COLORS[m.id]}}/>
                <div><strong>{m.label}</strong><small>{m.family}</small></div>
                <span className="run-time">{latestRuns.get(m.id)?formatDate(latestRuns.get(m.id)):'Not yet ingested'}</span>
              </div>)}</div>
            </section>
            <section className="panel">
              <div className="panel-header"><div><span className="eyebrow">MATCHED CASES</span><h3>Recent verification pairs</h3><p>Forecast minus nearest METAR observation</p></div><Activity size={19} className="panel-icon"/></div>
              <div className="table-scroll"><table><thead><tr><th>VALID</th><th>MODEL</th><th>FCST</th><th>OBS</th><th>ERROR</th></tr></thead>
                <tbody>{recentPairs.length?recentPairs.map((x,i)=><tr key={i}><td>{shortTime(x.valid)}</td><td>{x.model}</td><td>{number(x.forecast)}</td><td>{number(x.observed)}</td><td className={x.error>0?'warm':x.error<0?'cool':''}>{signed(x.error)}</td></tr>)
                  :<tr><td colSpan={5} className="no-data-table">No recent matched cases</td></tr>}</tbody></table></div>
            </section>
          </div>
        </>}

        {page==='probabilistic'&&<>
          <div className="prob-intro"><div className="prob-symbol"><Target size={31}/></div>
            <div><span className="eyebrow">DEVELOPMENT STATUS · NOT LIVE</span><h2>NBM quantile verification</h2><p>This release verifies deterministic-style station guidance. It does <strong>not</strong> infer percentiles from NBM text-card standard deviations or report fabricated coverage and CRPS values.</p></div>
            <div className="planned-badge"><CircleAlert size={15}/> QMD ingestion pending</div></div>
          <div className="prob-grid">
            {[{n:'01',title:'Quantile extraction',desc:'Sample archived NBM QMD P05–P95 GRIB2 fields at each station, preserving model run and valid time.',icon:Database},
              {n:'02',title:'Coverage & reliability',desc:'Verify nominal 50% and 80% prediction intervals and compute empirical CDF calibration.',icon:Target},
              {n:'03',title:'Distribution skill',desc:'Compute quantile pinball loss and weighted interval score with full sample sizes.',icon:BarChart3},
              {n:'04',title:'Regime diagnostics',desc:'Compare calibration across forecast lead, season, station, and observed weather regimes.',icon:CloudSun}
            ].map(item=><div className="prob-card" key={item.n}><div className="prob-card-head"><span>{item.n} / PLANNED</span><item.icon size={21}/></div><h3>{item.title}</h3><p>{item.desc}</p><div className="pending-line"><span className="dot amber"/> Not yet verified</div></div>)}
          </div>
          <div className="notice info"><BookOpen size={18}/> Nominal P10–P90 coverage is 80% in a calibrated distribution, but that property must be measured from actual QMD quantiles. The NBS/NBE text products here are not a substitute.</div>
        </>}

        {page==='methods'&&<>
          <div className="method-grid">
            <section className="panel method-card"><div className="method-number">01</div><h3>What is actually compared?</h3>
              <p>Archived NBM Short (NBS), NBM Extended (NBE), GFS MOS and NAM MOS station forecasts against ASOS/METAR observations. The latter two are MOS postprocessed forecasts, <strong>not raw GFS or NAM model output</strong>.</p></section>
            <section className="panel method-card"><div className="method-number">02</div><h3>How are times matched?</h3>
              <p>Each forecast is keyed by station, model, original model run and valid time. It is matched to the nearest available observation within ±{data.quality.observationToleranceMinutes} minutes. No interpolation is applied; missing values are excluded.</p></section>
            <section className="panel method-card"><div className="method-number">03</div><h3>How are errors scored?</h3>
              <p>Bias = mean(forecast − observation); MAE = mean absolute error; RMSE = root mean square error. Each score shows its own sample size. Lead-time bins use forecast valid time minus run time.</p></section>
            <section className="panel method-card"><div className="method-number">04</div><h3>What are the limitations?</h3>
              <p>Short rolling archive ({data.quality.archiveDays} days); no QMD percentile verification yet; no uniform common-case sample requirement; sparse gust verification; and no correction for differences in wind averaging or station exposure. Use findings as exploratory until the next quality-control phase.</p></section>
          </div>
          <div className="sources-panel"><div><span className="eyebrow">DATA PROVENANCE</span><h3>Documented open sources</h3></div>
            <div className="source-links">
              <a href="https://mesonet.agron.iastate.edu/mos/" target="_blank" rel="noreferrer"><ExternalLink size={15}/> IEM station MOS archive</a>
              <a href="https://mesonet.agron.iastate.edu/request/download.phtml" target="_blank" rel="noreferrer"><ExternalLink size={15}/> IEM ASOS archive</a>
              <a href="https://vlab.noaa.gov/web/mdl/nbm" target="_blank" rel="noreferrer"><ExternalLink size={15}/> NOAA NBM program</a>
            </div></div>
        </>}

        <footer><span><span className="footer-mark"><CheckCircle2 size={15}/></span> MODEL / VERIFY · Research preview</span><span>All timestamps rendered in America/Chicago · Automated updates are not guaranteed</span></footer>
      </div>
    </main>
  </div>
}

function ForecastGraph({points,unit}:{points:Record<string,string|number|null>[];unit:string}) {
  if (points.length===0) return <EmptyState title="Awaiting model and observation traces" description="The first scheduled ingestion will populate this panel with real, timestamped station data. No example forecasts are displayed as observations."/>
  const keys = MODEL_ORDER.filter(key=>points.some(p=>typeof p[key]==='number'))
  return <div className="chart-wrap">
    <div className="chart-legend"><span><i className="legend-line observed"/>Observed</span>
      {keys.map(key=><span key={key}><i className="legend-line" style={{background:MODEL_COLORS[key]}}/>{key==='NBS'?'NBM Short':key==='NBE'?'NBM Extended':key+' MOS'}</span>)}</div>
    <ResponsiveContainer width="100%" height={310}>
      <LineChart data={points} margin={{top:18,right:17,bottom:10,left:0}}>
        <CartesianGrid stroke="#24364a" strokeDasharray="3 5" vertical={false}/>
        <XAxis dataKey="valid" stroke="#8193a9" tick={{fontSize:11}} minTickGap={50} tickFormatter={(v:string)=>shortTime(v)} />
        <YAxis stroke="#8193a9" tick={{fontSize:11}} width={45} domain={['auto','auto']} unit={unit}/>
        <Tooltip contentStyle={{background:'#14253a',border:'1px solid #34506b',borderRadius:12,color:'#dce7f1'}}
          labelFormatter={v=>formatDate(String(v))} formatter={(v,name)=>{
            const val=typeof v==='number'?v:Number(v)
            return [number(val,1)+' '+unit, name==='observed'?'Observed':String(name)]
          }}/>
        <ReferenceLine y={0} stroke="#60758a" strokeOpacity={0.25}/>
        <Line dataKey="observed" name="Observed" type="monotone" stroke="#edf5fb" strokeWidth={2.5}
          dot={false} activeDot={{r:5}} connectNulls/>
        {keys.map(k=><Line key={k} dataKey={k} name={k} type="monotone" stroke={MODEL_COLORS[k]}
          strokeWidth={2.3} strokeDasharray="6 4" dot={false} activeDot={{r:4}} connectNulls/>)}
      </LineChart>
    </ResponsiveContainer>
    <div className="chart-foot"><span><Wind size={14}/> {unit==='kt'?'Wind reported in knots':'Temperatures in °F'}</span><span><ArrowUpRight size={14}/> Forecast traces use the latest ingested run per product</span></div>
  </div>
}
