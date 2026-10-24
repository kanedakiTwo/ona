/**
 * «Tiendas de Mimoia» hooks (PRO-358, specs/shop-orders.md → «Tiendas de
 * Mimoia»): the shops of the Red covering the household, its postal code
 * and the answer to «¿Ya le comprabas?»; and, for /admin, the Red itself.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { POSTAL_CODE_PATH, type AdminNetworkShop, type HouseholdNetworkView, type NetworkShop, type NetworkShopInput, type NetworkShopStatus, type Shop } from "@ona/shared"
import { api } from "@/lib/api"

export function useShopNetwork() {
  return useQuery<HouseholdNetworkView>({
    queryKey: ["shop-network"],
    queryFn: () => api.get<HouseholdNetworkView>("/shop-network"),
    staleTime: 30_000,
  })
}

export function useSetPostalCode() {
  const qc = useQueryClient()
  return useMutation<{ postalCode: string; changed: boolean }, Error, { postalCode: string }>({
    mutationFn: (body) => api.put(POSTAL_CODE_PATH, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shop-network"] })
      qc.invalidateQueries({ queryKey: ["ficha"] })
    },
  })
}

export function useAdoptNetworkShop() {
  const qc = useQueryClient()
  return useMutation<Shop, Error, { id: string; alreadyCustomer: boolean }>({
    mutationFn: ({ id, alreadyCustomer }) => api.post<Shop>(`/shop-network/${id}/adopt`, { alreadyCustomer }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shops"] })
      qc.invalidateQueries({ queryKey: ["shop-network"] })
      qc.invalidateQueries({ queryKey: ["shop-orders"] })
    },
  })
}

export function useAdminShopNetwork() {
  return useQuery<AdminNetworkShop[]>({
    queryKey: ["admin", "shop-network"],
    queryFn: () => api.get<AdminNetworkShop[]>("/admin/shop-network"),
  })
}

export function useSaveNetworkShop() {
  const qc = useQueryClient()
  return useMutation<NetworkShop, Error, { id?: string; body: NetworkShopInput | { status: NetworkShopStatus } }>({
    mutationFn: ({ id, body }) => (id ? api.patch<NetworkShop>(`/admin/shop-network/${id}`, body) : api.post<NetworkShop>("/admin/shop-network", body)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "shop-network"] }),
  })
}
