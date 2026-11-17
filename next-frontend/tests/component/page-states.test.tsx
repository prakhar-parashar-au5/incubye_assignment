// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import { ServiceUnavailable } from '@/components/shell/page-states';
import { HR_ACCESS_SERVICE } from '@/lib/hr-access';

afterEach(cleanup);

// QA run 03, D3: HR Access outages name HR Access, not the compensation service.
it('names the service that did not respond', () => {
  render(<ServiceUnavailable retryHref="/hr-access?q=Rohan" service={HR_ACCESS_SERVICE} />);
  expect(screen.getByText('HR Access is not responding')).toBeVisible();
  expect(screen.queryByText(/compensation/i)).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute('href', '/hr-access?q=Rohan');
});

it('keeps the compensation wording for the pages that use it', () => {
  render(<ServiceUnavailable retryHref="/employees" />);
  expect(screen.getByText('The compensation service is not responding')).toBeVisible();
});
