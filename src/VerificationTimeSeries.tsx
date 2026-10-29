import { useMemo, useState } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Info, Layers3 } from 'lucide-react'
import './verification-chart.css'

export type VerificationCase = {
  station: string
  element: string
  valid: string
  init: string
  lead: number
  observed: number
  observedAt?: string
  forecast: Record<string, number>
  guidance?: Record<string, number>
}

type SeriesKey = 'observed' | 'P10' | 'P25' | 'P50' | 'P75' | 'P90' | 'NBS' | 'NBE' | 'GFS' | 'NAM'
type PlotRow = {
  valid: string
  observed: number | null
  P10: number | null
  P25: number | null
  P50: number | null
  P75: number | null
  P90: number | null
  NBS: number | null
  NBE: number | null
  GFS: number | null
  NAM: number | null
  band80: [number, number] | null
  band50: [number, number] | null
}
const COLORS: Record<SeriesKey, string> = {
  observed:'#163b4c', P10:'#4caba3', P25:'#72b9b1', P50:'#087f76',
  P75:'#72b9b1', P90:'#4caba3', NBS:'#5578bd',
  NBE:'#398da6', GFS:'#b47b37', NAM:'#8b5aa2',
}
const LABELS: Record<SeriesKey, string> = {
  observed:'Observed', P10:'P10', P25:'P25', P50:'NBM P50', P75:'P75',
  P90:'P90', NBS:'NBM Short', NBE:'NBM Extended', GFS:'GFS MOS', NAM:'NAM MOS',
}
const GUIDANCE: SeriesKey[] = ['NBS','NBE','GFS','NAM']
const PERCENTILES: SeriesKey[] = ['P10','P25','P50','P75','P90']
const ALL_KEYS: SeriesKey[] = ['observed','P50',...GUIDANCE,'P10','P25','P75','P90']
const fmtDate = (value:string, detail=false) => new Intl.DateTimeFormat('en-US',{
  timeZone:'America/Chicago',month:'short',day:'numeric',
  ...(detail?{year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}:{}),
}).format(new Date(value))
function number(value:unknown):number|null {
  return typeof value==='number'&&Number.isFinite(value)?value:null
}
export function toPlotRows(cases:VerificationCase[],station:string,element:string,lead:number,days:number,referenceTime:number):PlotRow[] {
  const threshold=referenceTime-days*86400000
  const selected=cases.filter(row=>row.station===station&&row.element===element&&row.lead===lead&&
    new Date(row.valid).getTime()>=threshold&&new Date(row.valid).getTime()<=referenceTime)
    .sort((a,b)=>a.valid.localeCompare(b.valid))
  const rows=selected.map(item=>{
    const p=(value:number)=>number(item.forecast?.[String(value)])
    const p10=p(10),p25=p(25),p50=p(50),p75=p(75),p90=p(90)
    return {
      valid:item.valid,observed:number(item.observed),
      P10:p10,P25:p25,P50:p50,P75:p75,P90:p90,
      NBS:number(item.guidance?.NBS),NBE:number(item.guidance?.NBE),
      GFS:number(item.guidance?.GFS),NAM:number(item.guidance?.NAM),
      band80:p10!==null&&p90!==null?[p10,p90] as [number,number]:null,
      band50:p25!==null&&p75!==null?[p25,p75] as [number,number]:null,
    }
  })
  // A single station/lead/date corresponds to a single verified case.
  // Do not invent a value for a missing forecast or duplicate a vintage.
  const distinct=new Map<string,PlotRow>()
  rows.forEach(row=>{if(!distinct.has(row.valid))distinct.set(row.valid,row)})
  return [...distinct.values()]
}
function ValueTooltip({active,payload,unit}:{
  active?:boolean;payload?:readonly {payload?:PlotRow}[];unit:string
}) {
  if(!active||!payload?.length||!payload[0].payload)return null
  const row=payload[0].payload
  const observed=row.observed
  return <div className="verification-tooltip">
    <strong className="verification-tooltip-date">{fmtDate(row.valid,true)}</strong>
    <div className="verification-tooltip-row observed"><span>Observed</span><strong>{observed?.toFixed(1)??'—'} {unit}</strong></div>
    {ALL_KEYS.filter(key=>key!=='observed').map(key=>{
      const value=row[key]
      if(typeof value!=='number')return null
      return <div key={key} className="verification-tooltip-row">
        <span><i style={{background:COLORS[key]}}/>{LABELS[key]}</span>
        <span>{value.toFixed(1)} {unit}<small>{observed!==null?' · '+Math.abs(value-observed).toFixed(1)+' '+unit+' miss':''}</small></span>
      </div>
    })}
    <div className="verification-tooltip-footer">Same model initialization and valid time. Missing guidance omitted.</div>
  </div>
}
export default function VerificationTimeSeries({cases,station,element,lead,days,referenceTime}:{
  cases:VerificationCase[];station:string;element:string;lead:number;days:number;referenceTime:number
}) {
  const [showBands,setShowBands]=useState(true)
  const [showAllPercentiles,setShowAllPercentiles]=useState(false)
  const [visible,setVisible]=useState<Record<SeriesKey,boolean>>({
    observed:true,P10:false,P25:false,P50:true,P75:false,P90:false,
    NBS:true,NBE:true,GFS:true,NAM:true,
  })
  const rows=useMemo(()=>toPlotRows(cases,station,element,lead,days,referenceTime),
    [cases,station,element,lead,days,referenceTime])
  const eligible=useMemo(()=>new Set(ALL_KEYS.filter(key=>rows.some(row=>typeof row[key]==='number'))),[rows])
  const showLine=(key:SeriesKey)=>visible[key]&&eligible.has(key)&&
    (key==='observed'||key==='P50'||showAllPercentiles||GUIDANCE.includes(key))
  const changeAllPercentiles=()=>{
    const next=!showAllPercentiles
    setShowAllPercentiles(next)
    setVisible(prev=>({...prev,P10:next,P25:next,P50:true,P75:next,P90:next}))
  }
  const buttons=showAllPercentiles?ALL_KEYS:ALL_KEYS.filter(key=>key==='observed'||key==='P50'||GUIDANCE.includes(key))
  const hasBands=rows.some(row=>row.band80!==null)
  const unit='°F'
  return <section className="surface verification-chart-card" aria-label="Observed versus forecast guidance time series">
    <div className="verification-chart-head">
      <div><span className="eyebrow">01 · FORECASTS VS. VERIFIED OBSERVATIONS</span>
        <h2>Observed vs. guidance through time</h2>
        <p>The dark line tracks actual observations. Colored lines show what the 00Z forecast cycle predicted for the same station, weather element and lead.</p></div>
      <div className="verification-chart-count"><strong>{rows.length}</strong><span>verified dates</span></div>
    </div>
    {station==='ALL'?<div className="verification-chart-empty"><Layers3 size={25}/>
      <strong>Select one station for the line chart</strong><p>Connecting temperatures from different airports would be misleading. Choose a station above; the regional rankings remain available.</p></div>
    :rows.length===0?<div className="verification-chart-empty"><Layers3 size={25}/>
      <strong>No matched times in this selection</strong><p>Try another station, element, forecast lead or longer period. Missing guidance is never filled with invented values.</p></div>
    :<>
      <div className="verification-chart-controls">
        <label className="verification-switch"><input type="checkbox" checked={showBands}
          onChange={e=>setShowBands(e.target.checked)}/><span>Shaded percentile bands</span></label>
        <label className="verification-switch"><input type="checkbox" checked={showAllPercentiles}
          onChange={changeAllPercentiles}/><span>All percentile lines</span></label>
        <small>{showBands?'P10–P90 / P25–P75 shaded':'Bands hidden'}</small>
      </div>
      <div className="verification-series" aria-label="Select which forecast lines are visible">
        {buttons.map(key=><button key={key} type="button" aria-pressed={showLine(key)}
          disabled={!eligible.has(key)}
          className={'verification-series-btn'+(showLine(key)?' selected':'')}
          onClick={()=>setVisible(prev=>({...prev,[key]:!prev[key]}))}
          title={!eligible.has(key)?'No forecast from the matching cycle':'Toggle '+LABELS[key]}>
          <i style={{background:COLORS[key]}}/>{LABELS[key]}{!eligible.has(key)&&<small> · no data</small>}
        </button>)}
      </div>
      <div className="verification-plot-scroll"><div className="verification-plot">
        <ResponsiveContainer width="100%" height={355}>
          <ComposedChart data={rows} margin={{top:14,right:18,bottom:8,left:2}}>
            <CartesianGrid stroke="#e8eef0" strokeDasharray="3 4" vertical={false}/>
            <XAxis dataKey="valid" tickFormatter={x=>fmtDate(String(x))}
              tick={{fontSize:11,fill:'#627c89'}} tickLine={false}
              axisLine={{stroke:'#dce7e9'}} minTickGap={18}/>
            <YAxis tick={{fontSize:11,fill:'#627c89'}} tickLine={false} axisLine={false}
              width={45} tickFormatter={(value:number)=>String(value)+'°'} domain={['auto','auto']}/>
            <Tooltip content={<ValueTooltip unit={unit}/>}
              cursor={{stroke:'#7b98a6',strokeDasharray:'3 3'}}/>
            {showBands&&hasBands&&<>
              <Area type="linear" dataKey="band80" stroke="none" fill="#4fafa6"
                fillOpacity={0.12} legendType="none" tooltipType="none"
                connectNulls={false} isAnimationActive={false}/>
              <Area type="linear" dataKey="band50" stroke="none" fill="#3c9e95"
                fillOpacity={0.20} legendType="none" tooltipType="none"
                connectNulls={false} isAnimationActive={false}/>
            </>}
            {ALL_KEYS.filter(showLine).map(key=><Line key={key} type="linear"
              dataKey={key} name={LABELS[key]} stroke={COLORS[key]}
              strokeWidth={key==='observed'?3.8:key==='P50'?2.7:1.8}
              strokeDasharray={PERCENTILES.includes(key)&&key!=='P50'?'5 4':undefined}
              dot={{r:rows.length===1?5:key==='observed'?3.5:2}}
              activeDot={{r:5}} connectNulls={false} isAnimationActive={false}/>)}
          </ComposedChart>
        </ResponsiveContainer>
      </div></div>
      <p className="verification-chart-foot"><Info size={15}/>
        Hover or tap a date to see observed temperature, individual guidance values and forecast misses.
        Only guidance with the <strong>identical initialization and valid time</strong> is drawn;
        missing or incompatible model runs are not interpolated.
        {rows.length<5?' Very few verifying dates have accumulated for this selection.':''}
      </p>
    </>}
  </section>
}
