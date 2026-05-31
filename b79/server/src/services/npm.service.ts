import archiver from 'archiver';
import { Readable } from 'stream';
import { DataSourceType } from '../models/DataSource';
import codeGeneratorService from './codeGenerator.service';

class NpmService {
  async createNpmPackage(
    name: string,
    version: string,
    type: DataSourceType,
    generatedCode: string
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const archive = archiver('zip', {
        zlib: { level: 9 }
      });

      const chunks: Buffer[] = [];
      archive.on('data', (chunk) => chunks.push(chunk));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);

      const packageJson = codeGeneratorService.generatePackageJson(name, version, type);
      archive.append(packageJson, { name: 'package.json' });
      archive.append(generatedCode, { name: 'index.js' });
      archive.append(this.generateReadme(name, type), { name: 'README.md' });

      archive.finalize();
    });
  }

  private generateReadme(name: string, type: DataSourceType): string {
    return `# ${name} Connector

A data source connector for ${type}.

## Installation

\`\`\`bash
npm install ${name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}
\`\`\`

## Usage

\`\`\`javascript
const Connector = require('${name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}');

async function main() {
  const connector = new Connector({
    // your configuration
  });
  
  const result = await connector.connect();
  console.log(result);
}

main();
\`\`\`

## License

MIT
`;
  }
}

export default new NpmService();
