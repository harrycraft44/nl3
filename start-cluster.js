const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');

const rootDir = __dirname;
const cnodeDir = path.join(rootDir, 'Federation Node');
const node2Dir = path.join(rootDir, 'Community Node');
const node3Dir = path.join(rootDir, '.temp-node3');

// ------------------------------------ READ ME ------------------------------
// 1. for debuging the node data is reset to allow the full process testing
// -- do not run for production --
// ----------------------------------------------------------------------------
async function main() {
    console.log("Starting cluster initialization...");
    //clear databases and config
    if (fs.existsSync(path.join(node2Dir, 'data.sqlite'))) {
        await fs.remove(path.join(node2Dir, 'data.sqlite'));
    }
    if (fs.existsSync(path.join(node2Dir, 'config.json'))) {
        await fs.remove(path.join(node2Dir, 'config.json'));
    }
    // clear node data fed node data groups-registry.json
    if (fs.existsSync(path.join(cnodeDir, 'groups-registry.json'))) {
        await fs.remove(path.join(cnodeDir, 'groups-registry.json'));
    }
    if (fs.existsSync(path.join(cnodeDir, 'nodes-registry.json'))) {
        await fs.remove(path.join(cnodeDir, 'nodes-registry.json'));
    }

    // Clean up temp dir if exists
    if (fs.existsSync(node3Dir)) {
        await fs.remove(node3Dir);
    }

    // Copy Community Node to temp
    await fs.copy(node2Dir, node3Dir);
    console.log("Duplicated Community Node into .temp-node3");

    // Spawn processes
    const spawnNode = (name, cwd, env) => {
        console.log(`Starting ${name}...`);
        const p = spawn('node', ['server.js'], {
            cwd,
            env: { ...process.env, ...env },
            stdio: 'inherit'
        });
        return p;
    };

    spawnNode('Federation Node', cnodeDir, { PORT: 3000 });
    spawnNode('Community Node 2', node2Dir, { PORT: 3001, NODE_NAME: 'node2' });
    spawnNode('Community Node 3', node3Dir, { PORT: 3002, NODE_NAME: 'node3' });
    // print out urls
    console.log("Federation Node: http://localhost:3000");
    console.log("Community Node 2: http://localhost:3001");
    console.log("Community Node 3: http://localhost:3002");
}
// on contorl + c it should shudown all the processes and print out the stats
process.on('SIGINT', () => {
    console.log("Shutting down cluster...");
    // close all processes
    // clean up data and temp dir
    if (fs.existsSync(path.join(cnodeDir, 'data.sqlite'))) {
        fs.remove(path.join(cnodeDir, 'data.sqlite'));
    }
    if (fs.existsSync(path.join(cnodeDir, 'config.json'))) {
        fs.remove(path.join(cnodeDir, 'config.json'));
    }
    if (fs.existsSync(path.join(node2Dir, 'data.sqlite'))) {
        fs.remove(path.join(node2Dir, 'data.sqlite'));
    }
    if (fs.existsSync(path.join(node2Dir, 'config.json'))) {
        fs.remove(path.join(node2Dir, 'config.json'));
    }
    if (fs.existsSync(path.join(node3Dir, 'data.sqlite'))) {
        fs.remove(path.join(node3Dir, 'data.sqlite'));
    }
    if (fs.existsSync(path.join(node3Dir, 'config.json'))) {
        fs.remove(path.join(node3Dir, 'config.json'));
    }
    if (fs.existsSync(node3Dir)) {
        fs.remove(node3Dir);
    }
    process.exit(0);
});
main().catch(console.error);
