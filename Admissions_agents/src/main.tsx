import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { installFetchAuthInterceptor } from './lib/auth';

installFetchAuthInterceptor();

const AssessmentTool = lazy(() => import('./components/AssessmentTool'));
const StudentPortalEntry = lazy(() => import('./components/StudentPortalEntry'));

const pathname = window.location.pathname;
const isAssessmentRoute = pathname === '/assessment' || pathname.startsWith('/assessment/');
const isStudentPortalRoute = pathname === '/portal' || pathname.startsWith('/portal/');

const root = createRoot(document.getElementById('root')!);

const loadingFallback = <div className="min-h-screen flex items-center justify-center text-gray-400">加载中…</div>;

if (isAssessmentRoute) {
  root.render(
    <StrictMode>
      <Suspense fallback={loadingFallback}>
        <AssessmentTool />
      </Suspense>
    </StrictMode>,
  );
} else if (isStudentPortalRoute) {
  root.render(
    <StrictMode>
      <Suspense fallback={loadingFallback}>
        <StudentPortalEntry />
      </Suspense>
    </StrictMode>,
  );
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
