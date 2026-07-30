import { useCallback, useEffect, useState, type DependencyList } from 'react'

interface ResourceState<T> {
  data: T | null
  loading: boolean
  error: string | null
}

export interface Resource<T> extends ResourceState<T> {
  reload: () => Promise<void>
  setData: React.Dispatch<React.SetStateAction<T | null>>
}

export function useResource<T>(
  loader: () => Promise<T>,
  dependencies: DependencyList,
): Resource<T> {
  const [state, setState] = useState<ResourceState<T>>({
    data: null,
    loading: true,
    error: null,
  })

  const reload = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }))
    try {
      const data = await loader()
      setState({ data, loading: false, error: null })
    } catch (error) {
      setState({
        data: null,
        loading: false,
        error: error instanceof Error ? error.message : '读取数据失败',
      })
    }
  }, dependencies)

  useEffect(() => {
    void reload()
  }, [reload])

  const setData = useCallback((next: React.SetStateAction<T | null>) => {
    setState((current) => ({
      ...current,
      data: typeof next === 'function'
        ? (next as (value: T | null) => T | null)(current.data)
        : next,
    }))
  }, [])

  return { ...state, reload, setData }
}
