import dotenv from 'dotenv';
import { ApiServer } from './api/server';

// Cargar variables de entorno
dotenv.config();

// Validar variables requeridas
const requiredEnvVars = [
    'ZOOM_EMAIL',
    'ZOOM_PASSWORD',
    'GCS_BUCKET_NAME',
    'GCS_PROJECT_ID',
];

for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        console.error(`❌ Variable de entorno faltante: ${envVar}`);
        process.exit(1);
    }
}

// Iniciar servidor
const port = parseInt(process.env.API_PORT || '3000');
const server = new ApiServer(port);
server.start();

console.log('✅ Zoom Meeting Bot iniciado');
console.log('📚 Documentación de API:');
console.log('  POST /bot/start - Iniciar bot');
console.log('  POST /bot/join - Unirse a reunión');
console.log('  POST /bot/stream - Transmitir video');
console.log('  POST /bot/leave - Salir de reunión');
console.log('  POST /bot/stop - Detener bot');
console.log('  GET  /videos - Listar videos disponibles');