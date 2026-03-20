/**
 * importModule — dynamic import with TypeScript support via tsx.
 */

export async function importModule(fullPath: string): Promise<any> {
    const isTS = /\.[mc]?ts$/.test(fullPath);

    if (isTS) {
        try {
            const { tsImport } = await import("tsx/esm/api");
            return await tsImport(fullPath, import.meta.url);
        } catch (err: any) {
            // If tsx itself failed to load, give a clear message
            if (err?.code === "ERR_MODULE_NOT_FOUND" && err.message?.includes("tsx")) {
                throw new Error(
                    `Cannot load TypeScript file: ${fullPath}\n` +
                    `Install tsx: npm install -D tsx`,
                );
            }
            throw err;
        }
    }

    return await import(fullPath);
}
