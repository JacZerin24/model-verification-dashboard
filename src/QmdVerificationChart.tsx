import {useMemo,useState} from 'react'
import {Area,CartesianGrid,ComposedChart,Line,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts'
import {Info} from 'lucide-react'

type Case={station:string;element:string;valid:string;observedAt:string;init:string;lead:number;observed:number;forecast:Record<string,number>;guidance?:Record<string,number>}
type Key='observed'|'P10'|'P25'|'P50'|'P75'|'P90'|'NBS'|'NBE'|'GFS'|'NAM'|'bands'
type Row={valid:string;init:string;observedAt:string;observed:number;P10:number;P25:number;P50:number;P75:number;P90:number;band80:[number,number];band50:[number,number];NBS:number|null;NBE:number|null;GFS:number|null;NAM:number|null}
const lines:{key:Exclude<Key,'bands'>;label:string;color:string;kind:string}[]=[
 {key:'observed',label:'Observed',color:'#183449',kind:'observed'},
 {key:'P50',label:'NBM P50',color:'#bc477b',kind:'percentile'},
 {key:'NBS',label:'NBM Short',color:'#148e81',kind:'model'},
 {key:'NBE',label:'NBM Extended',color:'#5276c4',kind:'model'},
 {key:'GFS',label:'GFS MOS',color:'#cb8237',kind:'model'},
 {key:'NAM',label:'NAM MOS',color:'#8860a9',kind:'model'},
 {key:'P10',label:'P10',color:'#4b6e9b',kind:'percentile'},
 {key:'P25',label:'P25',color:'#5f91b0',kind:'percentile'},
 {key:'P75',label:'P75',color:'#b36892',kind:'percentile'},
 {key:'P90',label:'P90',color:'#994267',kind:'percentile'},
]
const initially:Record<Key,boolean>={observed:true,P50:true,NBS:true,NBE:true,GFS:true,NAM:true,P10:false,P25:false,P75:false,P90:false,bands:true}
const formatTime=(value:string)=>new Date(value).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/Chicago',timeZoneName:'short'})
export default function QmdVerificationChart({cases,station,element,lead,days,generatedAt}:{cases:Case[];station:string;element:string;lead:number;days:number;generatedAt:string|null}){
 const [visible,setVisible]=useState<Record<Key,boolean>>(initially)
 const [preset,setPreset]=useState<'bands'|'lines'>('bands')
 const rows=useMemo(()=>{
  const now=generatedAt?new Date(generatedAt).getTime():Date.now()
  return cases.filter(c=>c.station===station&&c.element===element&&c.lead===lead&&new Date(c.valid).getTime()<=now&&new Date(c.valid).getTime()>=now-days*86400000)
   .sort((a,b)=>a.valid.localeCompare(b.valid)).map((c):Row=>({
    valid:c.valid,init:c.init,observedAt:c.observedAt,observed:c.observed,
    P10:c.forecast['10'],P25:c.forecast['25'],P50:c.forecast['50'],P75:c.forecast['75'],P90:c.forecast['90'],
    band80:[c.forecast['10'],c.forecast['90']],band50:[c.forecast['25'],c.forecast['75']],
    NBS:c.guidance?.NBS??null,NBE:c.guidance?.NBE??null,GFS:c.guidance?.GFS??null,NAM:c.guidance?.NAM??null,
   }))
 },[cases,station,element,lead,days,generatedAt])
 const available=(key:Key)=>key==='bands'||rows.some(r=>typeof r[key as keyof Row]==='number')
 const changePreset=(view:'bands'|'lines')=>{
  setPreset(view)
  setVisible(v=>({...v,bands:view==='bands',P10:view==='lines',P25:view==='lines',P75:view==='lines',P90:view==='lines'}))
 }
 if(!rows.length)return <div className="qmd-empty-chart"><strong>No matching observations for this selection yet</strong><p>Try a different station or forecast lead. Only complete, previously issued percentile forecasts are plotted.</p></div>
 return <div className="qmd-timechart">
  <div className="qmd-timechart-controls">
   <div className="qmd-timechart-presets" role="group" aria-label="Percentile display">
    <button type="button" className={preset==='bands'?'active':''} aria-pressed={preset==='bands'} onClick={()=>changePreset('bands')}>Shaded ranges</button>
    <button type="button" className={preset==='lines'?'active':''} aria-pressed={preset==='lines'} onClick={()=>changePreset('lines')}>Individual percentile lines</button>
   </div>
   <span>{rows.length} verified times · °F</span>
  </div>
  <div className="qmd-timechart-toggles" aria-label="Toggle observed and forecast lines">
   {lines.map(line=><button type="button" key={line.key} disabled={!available(line.key)}
     title={available(line.key)?'Show or hide '+line.label:'No matching same-cycle guidance available'}
     className={'qmd-chart-chip '+(visible[line.key]&&available(line.key)?'active':'')}
     aria-pressed={visible[line.key]&&available(line.key]}
     onClick={()=>setVisible(v=>({...v,[line.key]:!v[line.key]}))}>
     <span className="qmd-chart-chip-swatch" style={{background:line.color}}/>{line.label}
     {!available(line.key)&&<small>no data</small>}
    </button>)}
   <button type="button" className={'qmd-chart-chip '+(visible.bands?'active':'')} aria-pressed={visible.bands}
     onClick={()=>setVisible(v=>({...v,bands:!v.bands}))}><span className="qmd-chart-chip-swatch qmd-band-swatch"/>Percentile bands</button>
  </div>
  <div className="qmd-timechart-plot">
   <ResponsiveContainer width="100%" height={375}>
    <ComposedChart data={rows} margin={{top:14,right:18,bottom:5,left:1}}>
     <CartesianGrid vertical={false} stroke="#e5edef" strokeDasharray="3 4"/>
     <XAxis dataKey="valid" tickLine={false} axisLine={false} minTickGap={40} tick={{fontSize:10,fill:'#6d8390'}}
       tickFormatter={(v:string)=>new Date(v).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'America/Chicago'})}/>
     <YAxis type="number" domain={['auto','auto']} width={43} tickLine={false} axisLine={false}
       tick={{fontSize:10,fill:'#6d8390'}} tickFormatter={(v:number)=>Math.round(v)+'°'}/>
     <Tooltip cursor={{stroke:'#8096a4',strokeDasharray:'4 3'}}
       content={({active,payload})=>{
        const row=payload?.[0]?.payload as Row|undefined
        if(!active||!row)return null
        return <div className="qmd-chart-tooltip">
         <strong>Valid: {formatTime(row.valid)}</strong>
         <small>Forecast issued: {formatTime(row.init)}</small>
         <small>METAR: {formatTime(row.observedAt)}</small>
         {lines.filter(line=>visible[line.key]&&typeof row[line.key as keyof Row]==='number').map(line=>{
          const value=row[line.key as keyof Row] as number
          return <div className="qmd-chart-tooltip-row" key={line.key}>
           <span><i style={{background:line.color}}/>{line.label}</span>
           <strong>{value.toFixed(1)}°F</strong>
           <small>{line.key==='observed'?'Reference':Math.abs(value-row.observed).toFixed(1)+'°F error'}</small>
          </div>
         })}
        </div>
       }}/>
     {visible.bands&&<Area dataKey="band80" type="linear" stroke="none" fill="#719bc6" fillOpacity={0.16} legendType="none" isAnimationActive={false} connectNulls={false}/>}
     {visible.bands&&<Area dataKey="band50" type="linear" stroke="none" fill="#559b9c" fillOpacity={0.22} legendType="none" isAnimationActive={false} connectNulls={false}/>}
     {lines.filter(line=>visible[line.key]&&available(line.key)).map(line=>
      <Line key={line.key} dataKey={line.key} name={line.label} type="linear" stroke={line.color}
       strokeWidth={line.kind==='observed'?3.6:line.key==='P50'?2.5:1.9}
       strokeDasharray={line.kind==='percentile'?'6 3':undefined}
       connectNulls={false} isAnimationActive={false}
       dot={rows.length<=20?{r:line.kind==='observed'?3.7:2.3}:false}
       activeDot={{r:5}}/>
     )}
    </ComposedChart>
   </ResponsiveContainer>
  </div>
  <p className="qmd-timechart-note"><Info size={15}/> Each point is a previously issued 00Z forecast valid at that time, compared with a METAR within 40 minutes. The shaded bands are actual NBM P10–P90 and P25–P75. MOS guidance appears only for an exact matching station, model initialization and valid time; missing data are not filled. GFS/NAM MOS are not raw deterministic models.</p>
 </div>
}
