#!/usr/bin/env python3
"""
Run with: python3 generate-kernels.sh
Stamps out Dockerfile + package.json for all mini-kernels.
Safe to re-run (skips existing files).
"""
import os, json

KERNELS = [
  "photo-sharing","messaging","video","music","live-dj","cad-collaboration",
  "robotics","gaming","education","health","finance","travel","food","art",
  "writing","ecommerce","news","events-calendar","environment","tech-opensource",
  "sports","parenting","mental-health"
]

DOCKERFILE = '''FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY src/ ./src/
EXPOSE 5000
CMD ["npx", "ts-node", "src/index.ts"]
'''

for k in KERNELS:
    d = f"mini-kernels/{k}"
    os.makedirs(f"{d}/src", exist_ok=True)

    pkg_path = f"{d}/package.json"
    if not os.path.exists(pkg_path):
        pkg = {
          "name": f"@colossus/mk-{k}", "version": "1.0.0", "private": True,
          "scripts": {"dev": "ts-node src/index.ts", "build": "tsc"},
          "dependencies": {
            "@apollo/server": "^4.10.0", "@apollo/subgraph": "^2.7.0",
            "graphql": "^16.8.0", "graphql-tag": "^2.12.0",
            "fastify": "^4.26.0", "pg": "^8.11.0",
            "nats": "^2.19.0", "pino": "^8.19.0"
          },
          "devDependencies": {"typescript": "^5.4.0", "ts-node": "^10.9.0"}
        }
        with open(pkg_path, 'w') as f:
            json.dump(pkg, f, indent=2)
        print(f"  created {pkg_path}")

    df_path = f"{d}/Dockerfile"
    if not os.path.exists(df_path):
        with open(df_path, 'w') as f:
            f.write(DOCKERFILE)
        print(f"  created {df_path}")

    stub_path = f"{d}/src/index.ts"
    if not os.path.exists(stub_path):
        class_name = ''.join(w.capitalize() for w in k.replace('-','_').split('_')) + 'Kernel'
        with open(stub_path, 'w') as f:
            f.write(f'''// TODO: implement {k} mini-kernel (see agents.json)
// Extend MiniKernelBase from ../../../main-kernel/src/lib/mini-kernel-base

export class {class_name} {{
  // Scaffold only – implement per agents.json task specification
}}
''')
        print(f"  created {stub_path}")

print(f"\\nDone. {len(KERNELS)} kernels scaffolded.")
