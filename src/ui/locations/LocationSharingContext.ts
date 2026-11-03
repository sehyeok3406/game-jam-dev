import { createContext, useContext } from 'react';
import type { LocationTarget } from '../../contracts/location-links.ts';
export type LocationSharing = {
  copy(target: LocationTarget): void;
  anchors: boolean;
};
export const LocationSharingContext = createContext<LocationSharing | null>(
  null,
);
export const useLocationSharing = () => useContext(LocationSharingContext);
