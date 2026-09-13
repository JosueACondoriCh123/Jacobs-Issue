import { createPortal } from 'react-dom'
import { useEchoStore } from '../shell/store'
import { MiniHud } from './MiniHud'
import './live.css'
export function LiveHudHost() {
  const {miniHud,hud,signal,modelState,persistenceState}=useEchoStore()
  const content=<MiniHud telemetry={hud.telemetry} signal={signal} pipeline={{model:modelState,persistence:persistenceState,connectionError:hud.error}} isFloating={miniHud.isFloating} onClose={miniHud.close}/>
  return <>{miniHud.host ? createPortal(content,miniHud.host) : null}{miniHud.fallbackOpen ? <div className="mini-hud-fallback">{content}</div> : null}</>
}
