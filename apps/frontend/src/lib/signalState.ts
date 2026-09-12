export type SignalState = 'WAITING' | 'STARTING' | 'LIVE' | 'STOPPED' | 'DENIED' | 'DISCONNECTED' | 'STALE' | 'ERROR'
export function getSignalState(running: boolean, lastSampleAt: number | null, now: number, stopped: boolean): SignalState {
  if (!running) return stopped ? 'STOPPED' : 'WAITING'
  if (lastSampleAt === null) return 'STARTING'
  return now-lastSampleAt > 2000 ? 'STALE' : 'LIVE'
}
export const signalLabels: Record<SignalState,string> = {
  WAITING:'Esperando captura',STARTING:'Iniciando micrófono',LIVE:'Señal en vivo',STOPPED:'Captura detenida',
  DENIED:'Permiso de micrófono denegado',DISCONNECTED:'Micrófono desconectado',STALE:'Sin señal reciente',ERROR:'Error de captura',
}
