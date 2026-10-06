require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'GameplanPlaceSearch'
  s.version = package['version']
  s.summary = package['description']
  s.license = 'MIT'
  s.homepage = 'https://github.com/local/gameplan-place-search'
  s.author = 'GamePlan'
  s.source = { :git => 'https://github.com/local/gameplan-place-search.git', :tag => s.version.to_s }
  s.source_files = 'ios/Sources/PlaceSearchPlugin/**/*.{swift,h,m,c,cc,mm,cpp}'
  s.ios.deployment_target = '15.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.1'
end
