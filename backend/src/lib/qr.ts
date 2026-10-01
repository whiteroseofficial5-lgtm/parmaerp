import QRCode from 'qrcode';
import { env } from '../config/env';

export const traceUrl = (batchNumber: string) => `${env.PUBLIC_APP_URL}/trace/${encodeURIComponent(batchNumber)}`;
export const qrPng = (text: string, width = 220) => QRCode.toBuffer(text, { width, margin: 1, errorCorrectionLevel: 'M' });
export const qrDataUrl = (text: string, width = 220) => QRCode.toDataURL(text, { width, margin: 1, errorCorrectionLevel: 'M' });
