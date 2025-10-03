import { Storage } from '@google-cloud/storage';
import * as path from 'path';
import * as fs from 'fs';

export class StorageManager {
    private storage: Storage;
    private bucketName: string;

    constructor(bucketName: string) {
        this.storage = new Storage({
            keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
        });
        this.bucketName = bucketName;
    }

    async downloadVideo(fileName: string, localPath?: string): Promise<string> {
        const destination = localPath || path.join(__dirname, '../../temp', fileName);

        // Crear directorio si no existe
        const dir = path.dirname(destination);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        console.log(`📥 Descargando ${fileName}...`);

        await this.storage
            .bucket(this.bucketName)
            .file(fileName)
            .download({ destination });

        console.log(`✅ Video descargado: ${destination}`);
        return destination;
    }

    async listVideos(): Promise<string[]> {
        const [files] = await this.storage.bucket(this.bucketName).getFiles();

        return files
            .filter(file => {
                const ext = path.extname(file.name).toLowerCase();
                return ['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(ext);
            })
            .map(file => file.name);
    }

    async getVideoMetadata(fileName: string) {
        const [metadata] = await this.storage
            .bucket(this.bucketName)
            .file(fileName)
            .getMetadata();

        return {
            name: fileName,
            size: metadata.size,
            contentType: metadata.contentType,
            updated: metadata.updated,
        };
    }
}