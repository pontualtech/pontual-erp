import { haversineKm, nearestNeighborOrder } from './geocoding'

/**
 * K-means balanceado (capacity-constrained) para divisao otima de
 * paradas entre N motoristas.
 *
 * Problema: dado um conjunto de OS georreferenciadas, dividir entre K
 * motoristas de forma que:
 *   1. Cada motorista pega paradas geograficamente proximas
 *   2. Cada motorista tem +/- a mesma quantidade de paradas (balanceado)
 *   3. Dentro de cada cluster, a ordem seja otima (nearest-neighbor)
 *
 * Algoritmo:
 *   1. Inicializa K centroides com k-means++ (escolhe pontos distantes
 *      entre si pra evitar clusters ruins)
 *   2. Itera:
 *      a. Ordena items por distancia ao centroide mais proximo
 *      b. Atribui em ordem, cada item ao centroide mais proximo que
 *         AINDA tem capacidade (cap = ceil(N/K))
 *      c. Recalcula centroides como media dos items atribuidos
 *      d. Para se nenhuma mudanca
 *   3. Ordena dentro de cada cluster por nearest-neighbor
 *
 * Items sem coords sao distribuidos round-robin no final (nao entram na
 * otimizacao geografica).
 *
 * Complexidade: O(iters * n * k) — pra n=50, k=3, iters=20 = 3000 ops.
 */

type WithCoords = { lat: number | null; lng: number | null }

function kMeansPPInit<T extends WithCoords>(items: (T & { lat: number; lng: number })[], k: number): { lat: number; lng: number }[] {
  // k-means++ — primeiro centroide random, depois escolhe pontos mais distantes
  // como centroides, com probabilidade proporcional a dist^2
  if (items.length === 0) return []
  const centroids: { lat: number; lng: number }[] = []
  centroids.push({ lat: items[0].lat, lng: items[0].lng })

  while (centroids.length < k) {
    let maxDist = -1
    let best = items[0]
    for (const item of items) {
      const minDist = Math.min(...centroids.map(c => haversineKm(c, item)))
      if (minDist > maxDist) { maxDist = minDist; best = item }
    }
    centroids.push({ lat: best.lat, lng: best.lng })
  }
  return centroids
}

export type ClusterResult<T> = {
  assignments: T[][] // array de len k — cada cluster contem seus items na ordem otima
  iterations: number
  balanced: boolean // true se todos os clusters ficaram dentro da tolerancia
}

export function balancedKMeans<T extends WithCoords>(
  items: T[],
  k: number,
  options: { maxIterations?: number; startPoint?: { lat: number; lng: number } | null } = {},
): ClusterResult<T> {
  const maxIterations = options.maxIterations ?? 25
  const startPoint = options.startPoint ?? null
  if (k <= 0) return { assignments: [], iterations: 0, balanced: true }
  if (items.length === 0) {
    return { assignments: Array.from({ length: k }, () => []), iterations: 0, balanced: true }
  }
  if (k === 1) {
    const sorted = nearestNeighborOrder(items)
    return { assignments: [sorted], iterations: 0, balanced: true }
  }

  const withCoords = items.filter(i => i.lat !== null && i.lng !== null) as (T & { lat: number; lng: number })[]
  const withoutCoords = items.filter(i => i.lat === null || i.lng === null)

  // Capacidade por cluster — pra N=28 e K=3, cap=10 (10, 10, 8)
  const cap = Math.ceil(withCoords.length / k)

  if (withCoords.length === 0) {
    // Round-robin dos sem-coord
    const assignments: T[][] = Array.from({ length: k }, () => [])
    items.forEach((item, idx) => assignments[idx % k].push(item))
    return { assignments, iterations: 0, balanced: true }
  }

  let centroids = kMeansPPInit(withCoords, k)
  let assignments: (T & { lat: number; lng: number })[][] = Array.from({ length: k }, () => [])
  let iterations = 0

  for (let iter = 0; iter < maxIterations; iter++) {
    iterations = iter + 1
    // 1. Para cada item, calcula distancia a cada centroide e ranqueia preferencias
    const preferences = withCoords.map(item => {
      const dists = centroids.map((c, ci) => ({ ci, dist: haversineKm(c, item) }))
      dists.sort((a, b) => a.dist - b.dist)
      return { item, dists }
    })

    // 2. Ordena items pelo "custo de segunda escolha" (maior = mais critico
    // atender primeiro) — isso reduz quantos items acabam sendo empurrados
    // pra clusters longe por falta de capacidade
    preferences.sort((a, b) => (b.dists[1].dist - b.dists[0].dist) - (a.dists[1].dist - a.dists[0].dist))

    // 3. Atribui cada item ao cluster mais proximo que tem capacidade
    const newAssignments: (T & { lat: number; lng: number })[][] = Array.from({ length: k }, () => [])
    for (const { item, dists } of preferences) {
      for (const { ci } of dists) {
        if (newAssignments[ci].length < cap) {
          newAssignments[ci].push(item)
          break
        }
      }
    }

    // 4. Recalcula centroides
    const newCentroids = newAssignments.map((cluster, i) => {
      if (cluster.length === 0) return centroids[i]
      return {
        lat: cluster.reduce((s, x) => s + x.lat, 0) / cluster.length,
        lng: cluster.reduce((s, x) => s + x.lng, 0) / cluster.length,
      }
    })

    // 5. Converge se centroides quase iguais
    const moved = newCentroids.some((nc, i) => haversineKm(nc, centroids[i]) > 0.01)
    centroids = newCentroids
    assignments = newAssignments
    if (!moved) break
  }

  // 6. Dentro de cada cluster, ordena por nearest-neighbor.
  // Se houver startPoint (sede da empresa), usa como ponto de partida —
  // motorista sai da sede e volta pro ultimo cliente mais perto dali.
  // Senao, usa o centroide do cluster como partida (comportamento antigo).
  const finalAssignments: T[][] = assignments.map((cluster, i) => {
    if (cluster.length === 0) return []
    const start = startPoint || centroids[i]
    return nearestNeighborOrder(cluster, start) as T[]
  })

  // 7. Distribui sem-coords round-robin nos clusters menores primeiro
  for (const item of withoutCoords) {
    const smallest = finalAssignments
      .map((c, ci) => ({ ci, len: c.length }))
      .sort((a, b) => a.len - b.len)[0]
    finalAssignments[smallest.ci].push(item)
  }

  // 8. Checa se ficou balanceado (diferenca max <= 1)
  const sizes = finalAssignments.map(c => c.length)
  const balanced = Math.max(...sizes) - Math.min(...sizes) <= 1

  return { assignments: finalAssignments, iterations, balanced }
}
