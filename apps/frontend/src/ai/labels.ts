import type { RiskLevel } from '../types/hud';

export interface LabelEntry {
  es: string;
  risk: RiskLevel;
}

/**
 * Subconjunto curado del vocabulario YAMNet (521 clases) relevante para el HUD.
 * Claveado por NOMBRE en minusculas, no por indice: asi sobrevive a cambios de
 * version del class map. Lo que no esta aqui cae al fallback generico.
 */
export const YAMNET_LABELS: Record<string, LabelEntry> = {
  'siren': { es: 'Sirena de emergencia', risk: 'CRITICAL' },
  'fire alarm': { es: 'Alarma de incendio', risk: 'CRITICAL' },
  'smoke detector, smoke alarm': { es: 'Detector de humo', risk: 'CRITICAL' },
  'alarm': { es: 'Alarma', risk: 'CRITICAL' },
  'burglar alarm': { es: 'Alarma antirrobo', risk: 'CRITICAL' },
  'car alarm': { es: 'Alarma de auto', risk: 'ADVISORY' },
  'alarm clock': { es: 'Despertador', risk: 'NORMAL' },
  'vehicle horn, car horn, honking': { es: 'Bocina de vehículo', risk: 'ADVISORY' },
  'screaming': { es: 'Grito', risk: 'CRITICAL' },
  'crying, sobbing': { es: 'Llanto', risk: 'ADVISORY' },
  'baby cry, infant cry': { es: 'Llanto de bebé', risk: 'ADVISORY' },
  'dog': { es: 'Ladrido', risk: 'ADVISORY' },
  'bark': { es: 'Ladrido', risk: 'ADVISORY' },
  'glass': { es: 'Rotura de cristal', risk: 'CRITICAL' },
  'explosion': { es: 'Explosión', risk: 'CRITICAL' },
  'gunshot, gunfire': { es: 'Disparo', risk: 'CRITICAL' },
  'thunder': { es: 'Trueno', risk: 'ADVISORY' },
  'thump, thud': { es: 'Golpe / impacto', risk: 'ADVISORY' },
  'knock': { es: 'Golpe en puerta', risk: 'ADVISORY' },
  'doorbell': { es: 'Timbre de puerta', risk: 'ADVISORY' },
  'telephone bell ringing': { es: 'Timbre de teléfono', risk: 'ADVISORY' },
  'door, wood': { es: 'Puerta', risk: 'NORMAL' },
  'speech': { es: 'Voz / conversación', risk: 'NORMAL' },
  'laughter': { es: 'Risa', risk: 'NORMAL' },
  'clapping': { es: 'Aplausos', risk: 'NORMAL' },
  'walk, footsteps': { es: 'Pasos', risk: 'NORMAL' },
  'bicycle': { es: 'Bicicleta aproximándose', risk: 'ADVISORY' },
  'car': { es: 'Vehículo en movimiento', risk: 'ADVISORY' },
  'car passing by': { es: 'Vehículo en movimiento', risk: 'ADVISORY' },
  'motorcycle': { es: 'Motocicleta', risk: 'ADVISORY' },
  'truck': { es: 'Camión', risk: 'ADVISORY' },
  'bus': { es: 'Autobús', risk: 'ADVISORY' },
  'engine': { es: 'Motor', risk: 'NORMAL' },
  'engine starting': { es: 'Arranque de motor', risk: 'ADVISORY' },
  'wind': { es: 'Viento', risk: 'NORMAL' },
  'rain': { es: 'Lluvia', risk: 'NORMAL' },
  'water': { es: 'Agua', risk: 'NORMAL' },
  'crowd': { es: 'Multitud', risk: 'NORMAL' },
  'music': { es: 'Música', risk: 'NORMAL' },
  'silence': { es: 'Silencio', risk: 'NORMAL' },
  'noise': { es: 'Ruido ambiental', risk: 'NORMAL' },
  'static': { es: 'Ruido ambiental', risk: 'NORMAL' },
  'vacuum cleaner': { es: 'Aspiradora', risk: 'NORMAL' },
  'microwave oven': { es: 'Microondas', risk: 'NORMAL' },
  'blender': { es: 'Licuadora', risk: 'NORMAL' },
  'toilet flush': { es: 'Descarga de agua', risk: 'NORMAL' },
  'shower': { es: 'Ducha', risk: 'NORMAL' },
  'cat': { es: 'Maullido', risk: 'NORMAL' },
  'bird': { es: 'Ave', risk: 'NORMAL' },
  'cough': { es: 'Tos', risk: 'NORMAL' },
  'sneeze': { es: 'Estornudo', risk: 'NORMAL' },
  'snoring': { es: 'Ronquido', risk: 'NORMAL' },
};

export function lookupYamnetLabel(name: string): LabelEntry | null {
  return YAMNET_LABELS[name.trim().toLowerCase()] ?? null;
}
