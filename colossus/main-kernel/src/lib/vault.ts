import NodeVault from 'node-vault';
export const vault = NodeVault({
  apiVersion: 'v1',
  endpoint: process.env.VAULT_ADDR ?? 'http://localhost:8200',
  token: process.env.VAULT_TOKEN,
});
