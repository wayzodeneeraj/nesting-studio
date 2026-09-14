import { createRoot } from 'react-dom/client';
import App from './App';
import {loadCatalog} from './datasets';
import { prepareIsolation } from './isolation';
void prepareIsolation().then(async () => {
  createRoot(document.getElementById('root')!).render(<App/>);
  void loadCatalog().catch(()=>{});
});
