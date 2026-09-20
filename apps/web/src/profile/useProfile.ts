import type { Profile } from '@job-getter/contracts';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useApi } from '../api/ApiProvider';

export const PROFILE_QUERY_KEY = ['profile'] as const;

/** The workspace profile, shared by the profile and import screens. */
export function useProfileQuery(): UseQueryResult<Profile> {
  const api = useApi();
  return useQuery({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: ({ signal }) => api.getProfile({ signal }),
  });
}

/** Records the profile a mutation returned, so no second GET is needed. */
export function useSetProfile(): (profile: Profile) => void {
  const queryClient = useQueryClient();
  return useCallback(
    (profile: Profile) => {
      queryClient.setQueryData(PROFILE_QUERY_KEY, profile);
    },
    [queryClient],
  );
}
