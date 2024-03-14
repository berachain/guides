import axios from 'axios';

const api = axios.create({
  baseURL: 'https://bafybeieeacni3n347zk7lj3fy5pt5rm7sl6ntq2fcwv3clj7nzsvc27mky.ipfs.cf-ipfs.com/',
  headers: {
    'Authorization': `Bearer ${process.env.NEXT_PUBLIC_IPFS_ACCESS_TOKEN}`,
  },
});

export default api;